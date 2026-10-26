from dataclasses import dataclass, field
from math import inf

import numpy as np


@dataclass(frozen=True)
class Constraint:
    source: str
    target: str
    bound: float
    name: str
    confidence: float = 1.0
    passages: tuple[str, ...] = ()


@dataclass
class STNSolution:
    distances: dict[tuple[str, str], float]
    conflicts: list[list[Constraint]] = field(default_factory=list)
    dropped: list[Constraint] = field(default_factory=list)

    def bounds(self, variable: str) -> tuple[float, float]:
        return -self.distances[(variable, "ZERO")], self.distances[("ZERO", variable)]


class SimpleTemporalNetwork:
    def __init__(self) -> None:
        self.constraints: list[Constraint] = []
        self.nodes: set[str] = {"ZERO"}

    def add(
        self,
        source: str,
        target: str,
        bound: float,
        name: str,
        confidence: float = 1.0,
        passages: tuple[str, ...] = (),
    ) -> None:
        self.nodes.update((source, target))
        self.constraints.append(Constraint(source, target, bound, name, confidence, passages))

    def interval(
        self,
        variable: str,
        lower: int,
        upper: int,
        name: str,
        confidence: float = 1.0,
        passages: tuple[str, ...] = (),
    ) -> None:
        self.add("ZERO", variable, upper, name + ":upper", confidence, passages)
        self.add(variable, "ZERO", -lower, name + ":lower", confidence, passages)

    def _negative_cycle(self, edges: list[Constraint]) -> list[Constraint]:
        distances = dict.fromkeys(self.nodes, 0.0)
        previous: dict[str, Constraint] = {}
        updated = None
        for _ in self.nodes:
            updated = None
            for edge in edges:
                if distances[edge.target] > distances[edge.source] + edge.bound:
                    distances[edge.target] = distances[edge.source] + edge.bound
                    previous[edge.target] = edge
                    updated = edge.target
            if updated is None:
                return []
        node = updated
        for _ in self.nodes:
            node = previous[node].source
        start = node
        cycle = []
        while True:
            edge = previous[node]
            cycle.append(edge)
            node = edge.source
            if node == start:
                return list(reversed(cycle))

    def _distances(self, edges: list[Constraint]) -> dict[tuple[str, str], float]:
        nodes = sorted(self.nodes)
        indices = {node: index for index, node in enumerate(nodes)}
        matrix = np.full((len(nodes), len(nodes)), inf, dtype=np.float64)
        np.fill_diagonal(matrix, 0)
        for edge in edges:
            source, target = indices[edge.source], indices[edge.target]
            matrix[source, target] = min(matrix[source, target], edge.bound)
        for middle in range(len(nodes)):
            matrix = np.minimum(matrix, matrix[:, middle, None] + matrix[None, middle, :])
        return {
            (source, target): float(matrix[left, right])
            for left, source in enumerate(nodes)
            for right, target in enumerate(nodes)
        }

    def solve(self) -> STNSolution:
        active = self.constraints.copy()
        conflicts = []
        dropped = []
        while cycle := self._negative_cycle(active):
            conflicts.append(cycle)
            weakest = min(cycle, key=lambda edge: (edge.confidence, edge.name))
            dropped.append(weakest)
            active.remove(weakest)
        return STNSolution(self._distances(active), conflicts, dropped)
