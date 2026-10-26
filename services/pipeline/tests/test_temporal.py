from datetime import date

import pytest

from candor_pipeline.temporal.normalize import normalize_time
from candor_pipeline.temporal.stn import SimpleTemporalNetwork


@pytest.mark.parametrize(
    ("expression", "earliest", "latest", "granularity"),
    [
        ("15 October 2026", "2026-10-15", "2026-10-15", "day"),
        ("2026-10-15", "2026-10-15", "2026-10-15", "day"),
        ("October 2026", "2026-10-01", "2026-10-31", "month"),
        ("early October 2026", "2026-10-01", "2026-10-10", "week"),
        ("mid October 2026", "2026-10-11", "2026-10-20", "week"),
        ("late February 2024", "2024-02-21", "2024-02-29", "week"),
        ("Q2 2026", "2026-04-01", "2026-06-30", "quarter"),
        ("2026 Q4", "2026-10-01", "2026-12-31", "quarter"),
        ("2026", "2026-01-01", "2026-12-31", "year"),
        ("last Tuesday", "2026-10-20", "2026-10-20", "day"),
        ("two weeks later", "2026-11-09", "2026-11-09", "day"),
        ("3 days ago", "2026-10-23", "2026-10-23", "day"),
        ("the following month", "2026-11-01", "2026-11-30", "month"),
        ("last month", "2026-09-01", "2026-09-30", "month"),
        ("yesterday", "2026-10-25", "2026-10-25", "day"),
        ("sometime", "2025-10-26", "2026-10-26", "unknown"),
        (None, "2025-10-26", "2026-10-26", "unknown"),
    ],
)
def test_normalization(
    expression: str | None, earliest: str, latest: str, granularity: str
) -> None:
    interval = normalize_time(expression, date(2026, 10, 26))
    assert interval.earliest.isoformat() == earliest
    assert interval.latest.isoformat() == latest
    assert interval.granularity == granularity


def test_before_after_and_missing_anchor() -> None:
    assert normalize_time("before 15 October 2026", date(2026, 10, 26)).latest == date(2026, 10, 14)
    assert normalize_time("after 15 October 2026", date(2026, 10, 26)).earliest == date(
        2026, 10, 16
    )
    assert normalize_time("last Tuesday", None).granularity == "unknown"
    assert normalize_time("2026-10-15", None).earliest == date(2026, 10, 15)


def test_stn_tightening() -> None:
    network = SimpleTemporalNetwork()
    network.interval("a", 10, 30, "a")
    network.interval("b", 20, 50, "b")
    network.add("a", "b", 5, "b_after_a_by_at_most_5")
    network.add("b", "a", 0, "a_before_b")
    result = network.solve()
    assert result.bounds("a") == (15, 30)
    assert result.bounds("b") == (20, 35)
    assert result.conflicts == []


def test_negative_cycle_extracts_sources_and_drops_weakest() -> None:
    network = SimpleTemporalNetwork()
    network.interval("a", 20, 20, "a", 0.9, ("D1.P001",))
    network.interval("b", 10, 10, "b", 0.9, ("D2.P001",))
    network.add("b", "a", 0, "a_before_b", 0.2, ("D3.P001",))
    result = network.solve()
    assert len(result.conflicts) == 1
    assert sum(edge.bound for edge in result.conflicts[0]) < 0
    assert result.dropped[0].name == "a_before_b"
    assert {passage for edge in result.conflicts[0] for passage in edge.passages} == {
        "D1.P001",
        "D2.P001",
        "D3.P001",
    }
    assert result.bounds("a") == (20, 20)
    assert result.bounds("b") == (10, 10)
    assert all(value >= 0 for (left, right), value in result.distances.items() if left == right)


def test_multiple_independent_cycles() -> None:
    network = SimpleTemporalNetwork()
    network.add("a", "b", -1, "ab")
    network.add("b", "a", 0, "ba")
    network.add("c", "d", -1, "cd")
    network.add("d", "c", 0, "dc")
    result = network.solve()
    assert len(result.conflicts) == 2
    assert len(result.dropped) == 2


def test_cycle_is_simple_and_irreducible() -> None:
    network = SimpleTemporalNetwork()
    network.add("a", "b", 3, "ab")
    network.add("b", "c", -5, "bc")
    network.add("c", "a", 1, "ca")
    cycle = network.solve().conflicts[0]
    assert len({edge.source for edge in cycle}) == len(cycle)
    for omitted in cycle:
        subset = SimpleTemporalNetwork()
        for edge in cycle:
            if edge != omitted:
                subset.add(edge.source, edge.target, edge.bound, edge.name)
        assert subset.solve().conflicts == []
