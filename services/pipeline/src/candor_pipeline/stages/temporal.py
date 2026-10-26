import math
import re
from datetime import date

from candor_pipeline.contracts import Claim, TemporalConflict, TimelineEvent
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.temporal.normalize import normalize_time
from candor_pipeline.temporal.stn import SimpleTemporalNetwork

FULL_DATE = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\b"
)


def text_anchor(text: str) -> date | None:
    for match in FULL_DATE.finditer(text):
        interval = normalize_time(match.group(0), None)
        if interval.granularity == "day":
            return interval.earliest
    return None


def add_links(
    network: SimpleTemporalNetwork, claim: Claim, known: set[str], confidence: float
) -> None:
    start, end = claim.claim_id + ":start", claim.claim_id + ":end"
    for link in claim.temporal_links:
        if link.other_claim_id not in known:
            continue
        other_start, other_end = link.other_claim_id + ":start", link.other_claim_id + ":end"
        name = f"{claim.claim_id}:{link.relation}:{link.other_claim_id}"
        passages = (link.evidence_passage_id,) if link.evidence_passage_id else ()
        pairs = {
            "before": [(other_start, end, 0)],
            "after": [(start, other_end, 0)],
            "during": [(start, other_start, 0), (other_end, end, 0)],
            "same_time": [
                (start, other_start, 1),
                (other_start, start, 1),
                (end, other_end, 1),
                (other_end, end, 1),
            ],
        }[link.relation]
        for index, (source, target, bound) in enumerate(pairs):
            network.add(source, target, bound, name + f":{index}", confidence, passages)


def topological_ranks(claims: list[Claim]) -> dict[str, int]:
    edges = {claim.claim_id: set() for claim in claims}
    for claim in claims:
        for link in claim.temporal_links:
            if link.other_claim_id not in edges:
                continue
            if link.relation == "before":
                edges[link.other_claim_id].add(claim.claim_id)
            elif link.relation == "after":
                edges[claim.claim_id].add(link.other_claim_id)
    ranks = {}
    while edges:
        ready = sorted(key for key, parents in edges.items() if not parents)
        if not ready:
            ready = [min(edges)]
        for key in ready:
            ranks[key] = len(ranks)
            edges.pop(key)
        for parents in edges.values():
            parents.difference_update(ready)
    return ranks


async def run(ctx: PipelineContext) -> StageOutput:
    anchors = {
        document.doc_id: document.anchor_date or text_anchor(document.text)
        for document in ctx.payload.documents
    }
    network = SimpleTemporalNetwork()
    originals = {}
    known = {claim.claim_id for claim in ctx.claims}
    referenced = {link.other_claim_id for claim in ctx.claims for link in claim.temporal_links}
    for claim in ctx.claims:
        expression = ctx.time_expressions.get(claim.claim_id)
        if not expression and not claim.temporal_links and claim.claim_id not in referenced:
            continue
        anchor = next(
            (
                anchors.get(cite.passage_id.split(".")[0])
                for cite in claim.citations
                if anchors.get(cite.passage_id.split(".")[0])
            ),
            None,
        )
        interval = normalize_time(expression, anchor)
        originals[claim.claim_id] = interval
        confidence = ctx.agreements[claim.claim_id]
        if interval.granularity == "unknown":
            confidence *= 0.25
        sources = tuple(cite.passage_id for cite in claim.citations)
        start, end = claim.claim_id + ":start", claim.claim_id + ":end"
        network.interval(
            start,
            interval.earliest.toordinal(),
            interval.latest.toordinal(),
            start,
            confidence,
            sources,
        )
        network.interval(
            end,
            interval.earliest.toordinal(),
            interval.latest.toordinal(),
            end,
            confidence,
            sources,
        )
        network.add(end, start, 0, claim.claim_id + ":start_before_end", 2.0)
    for claim in ctx.claims:
        add_links(network, claim, known, ctx.agreements[claim.claim_id] * 0.8)
    solution = network.solve()
    ranks = topological_ranks(ctx.claims)
    events = []
    for claim in ctx.claims:
        if claim.claim_id not in originals:
            continue
        original = originals[claim.claim_id]
        lower, _ = solution.bounds(claim.claim_id + ":start")
        _, upper = solution.bounds(claim.claim_id + ":end")
        low = int(lower) if math.isfinite(lower) else original.earliest.toordinal()
        high = int(upper) if math.isfinite(upper) else original.latest.toordinal()
        claim.time = original.model_copy(
            update={
                "earliest": date.fromordinal(max(1, low)),
                "latest": date.fromordinal(min(date.max.toordinal(), high)),
            }
        )
        if claim.kind == "event":
            events.append(
                TimelineEvent(
                    event_id=f"T{len(events) + 1:03d}",
                    claim_ids=[claim.claim_id],
                    title=claim.action,
                    interval=claim.time.model_copy(deep=True),
                    original_interval=original,
                    order_rank=0,
                    constraints=[
                        edge.name
                        for edge in network.constraints
                        if edge.source.startswith(claim.claim_id + ":")
                        or edge.target.startswith(claim.claim_id + ":")
                    ],
                )
            )
    events.sort(
        key=lambda event: (
            (event.interval.earliest.toordinal() + event.interval.latest.toordinal()) / 2,
            ranks[event.claim_ids[0]],
        )
    )
    for event in events:
        same = next(
            (
                item
                for item in ctx.timeline
                if re.sub(r"\W+", " ", item.title.casefold())
                == re.sub(r"\W+", " ", event.title.casefold())
                and item.interval.earliest <= event.interval.latest
                and event.interval.earliest <= item.interval.latest
            ),
            None,
        )
        if same:
            same.claim_ids.extend(event.claim_ids)
            same.constraints = sorted(set(same.constraints + event.constraints))
            same.interval.earliest = min(same.interval.earliest, event.interval.earliest)
            same.interval.latest = max(same.interval.latest, event.interval.latest)
        else:
            event.event_id = f"T{len(ctx.timeline) + 1:03d}"
            event.order_rank = len(ctx.timeline)
            ctx.timeline.append(event)
    for index, cycle in enumerate(solution.conflicts, 1):
        ids = {node.split(":")[0] for edge in cycle for node in (edge.source, edge.target)}
        ctx.temporal_conflicts.append(
            TemporalConflict(
                conflict_id=f"TC{index:03d}",
                event_ids=[event.event_id for event in ctx.timeline if ids & set(event.claim_ids)],
                description=(
                    "Incompatible temporal constraints; the weakest constraint was removed."
                ),
                constraints=[edge.name for edge in cycle],
                passages=sorted({passage for edge in cycle for passage in edge.passages}),
            )
        )
    return StageOutput()
