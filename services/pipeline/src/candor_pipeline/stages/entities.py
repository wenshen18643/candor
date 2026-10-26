import re

from candor_pipeline.contracts import Entity, Relation
from candor_pipeline.stages.context import PipelineContext, StageOutput
from candor_pipeline.stages.models import EntitiesOutput


class UnionFind:
    def __init__(self, values: list[str]) -> None:
        self.parents = {value: value for value in values}

    def find(self, value: str) -> str:
        self.parents.setdefault(value, value)
        if self.parents[value] != value:
            self.parents[value] = self.find(self.parents[value])
        return self.parents[value]

    def union(self, left: str, right: str) -> None:
        self.parents[self.find(left)] = self.find(right)


def explicitly_equates(left: str, right: str, quote: str) -> bool:
    connector = r"\s*(?:is(?:\s+also)?|=|also known as|is the same (?:person|entity) as|aka)\s*"
    return any(
        re.search(re.escape(a) + connector + re.escape(b), quote, re.I)
        for a, b in ((left, right), (right, left))
    )


async def run(ctx: PipelineContext) -> StageOutput:
    legend = {item.placeholder: item.type for item in ctx.payload.entity_legend}
    union = UnionFind(list(legend))
    output = await ctx.ask(
        "entities",
        EntitiesOutput,
        context={"entity_legend": [item.model_dump() for item in ctx.payload.entity_legend]},
    )
    passages = {passage.passage_id: passage for passage in ctx.passages}
    accepted = []
    for link in output.aliases if output else []:
        passage = passages[link.passage_id]
        if (
            link.placeholder not in legend
            or not link.quote
            or link.quote not in passage.text
            or link.alias not in link.quote
            or link.placeholder not in link.quote
            or passage.injection_risk >= ctx.config.quarantine_threshold
        ):
            continue
        if re.fullmatch(r"[A-Z]+_\d+", link.alias) and link.alias not in legend:
            continue
        left_group = {key for key in legend if union.find(key) == union.find(link.alias)}
        right_group = {key for key in legend if union.find(key) == union.find(link.placeholder)}
        if any(
            a != b and not explicitly_equates(a, b, link.quote)
            for a in left_group
            for b in right_group
        ):
            continue
        union.union(link.alias, link.placeholder)
        accepted.append(link)
    groups = {}
    for placeholder, kind in legend.items():
        root = union.find(placeholder)
        if root not in groups:
            groups[root] = Entity(entity_id=placeholder, placeholder=placeholder, type=kind)
        elif placeholder != groups[root].placeholder:
            groups[root].aliases.append(placeholder)
    for link in accepted:
        entity = groups[union.find(link.placeholder)]
        if link.alias != entity.placeholder and link.alias not in entity.aliases:
            entity.aliases.append(link.alias)
        entity.roles = sorted(set(entity.roles + link.roles))
    for entity in groups.values():
        names = [entity.placeholder, *entity.aliases]
        entity.mention_count = sum(
            len(re.findall(r"(?<!\w)" + re.escape(name) + r"(?!\w)", passage.text))
            for passage in ctx.passages
            for name in names
        )
    ctx.entities = list(groups.values())
    mapping = {
        name: entity.entity_id
        for entity in ctx.entities
        for name in [entity.placeholder, *entity.aliases]
    }
    relations: dict[tuple[str, str, str], Relation] = {}
    for claim in ctx.claims:
        for actor in claim.actors:
            for target in claim.targets:
                if actor not in mapping or target not in mapping:
                    continue
                key = mapping[actor], mapping[target], claim.action
                relation = relations.setdefault(
                    key, Relation(source=key[0], target=key[1], label=key[2])
                )
                relation.claim_ids.append(claim.claim_id)
    ctx.relations = list(relations.values())
    return StageOutput()
