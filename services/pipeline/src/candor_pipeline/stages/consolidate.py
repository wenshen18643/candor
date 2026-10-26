from itertools import combinations

from rapidfuzz.fuzz import token_set_ratio

from candor_pipeline.contracts import Claim
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import RawClaim


def jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / len(left | right) if left | right else 1.0


def similarity(left: RawClaim, right: RawClaim) -> float:
    return (
        0.6 * token_set_ratio(left.statement.casefold(), right.statement.casefold()) / 100
        + 0.2 * jaccard(set(left.actors), set(right.actors))
        + 0.2
        * jaccard(
            {cite.passage_id for cite in left.citations},
            {cite.passage_id for cite in right.citations},
        )
    )


def cluster_samples(
    samples: list[list[RawClaim]], threshold: float
) -> list[list[tuple[int, RawClaim]]]:
    clusters = [[(sample, claim)] for sample, claims in enumerate(samples) for claim in claims]
    while True:
        best: tuple[float, int, int] | None = None
        for left, right in combinations(range(len(clusters)), 2):
            if {item[0] for item in clusters[left]} & {item[0] for item in clusters[right]}:
                continue
            score = sum(similarity(a[1], b[1]) for a in clusters[left] for b in clusters[right])
            score /= len(clusters[left]) * len(clusters[right])
            if score >= threshold and (best is None or score > best[0]):
                best = score, left, right
        if best is None:
            return clusters
        _, left, right = best
        clusters[left].extend(clusters.pop(right))


async def run(ctx: PipelineContext) -> StageOutput:
    clusters = cluster_samples(ctx.samples, ctx.config.cluster_threshold)
    remap = {
        (sample, claim.claim_id): f"C{index:03d}"
        for index, cluster in enumerate(clusters, 1)
        for sample, claim in cluster
    }
    for index, cluster in enumerate(clusters, 1):
        medoid = max(
            cluster, key=lambda item: sum(similarity(item[1], other[1]) for other in cluster)
        )
        raw = medoid[1]
        claim_id = f"C{index:03d}"
        citations = {
            (cite.passage_id, cite.quote): cite.model_copy(deep=True)
            for _, claim in cluster
            for cite in claim.citations
        }
        links = {}
        for sample, member in cluster:
            for link in member.temporal_links:
                target = remap.get((sample, link.other_claim_id))
                if target and target != claim_id:
                    links[(link.relation, target, link.evidence_passage_id)] = link.model_copy(
                        update={"other_claim_id": target}
                    )
        docs = {citation.passage_id.split(".")[0] for citation in citations.values()}
        source = "reporter_statement" if docs == {"S"} else "mixed" if "S" in docs else "document"
        ctx.claims.append(
            Claim(
                claim_id=claim_id,
                statement=raw.statement,
                kind=raw.kind,
                actors=raw.actors,
                targets=raw.targets,
                action=raw.action,
                citations=list(citations.values()),
                temporal_links=list(links.values()),
                source_type=source,
            )
        )
        ctx.agreements[claim_id] = len(cluster) / ctx.config.samples
        ctx.time_expressions[claim_id] = raw.time_expression
    return StageOutput()
