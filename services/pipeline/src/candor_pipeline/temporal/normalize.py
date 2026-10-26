import calendar
import re
from datetime import date, datetime, timedelta

import dateparser
from dateutil.relativedelta import relativedelta

from candor_pipeline.contracts import Granularity, TimeInterval

MONTHS = {name.casefold(): index for index, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.casefold(): index for index, name in enumerate(calendar.month_abbr) if name})
NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


def normalize_time(expression: str | None, anchor: date | None) -> TimeInterval:
    try:
        return normalize_known_time(expression, anchor)
    except (ValueError, OverflowError):
        return unknown_interval(expression, anchor)


def unknown_interval(expression: str | None, anchor: date | None) -> TimeInterval:
    earliest = date.min
    if anchor is not None:
        earliest = anchor - timedelta(days=min(365, anchor.toordinal() - 1))
    return TimeInterval(
        earliest=earliest,
        latest=anchor or date.max,
        granularity="unknown",
        source_text=expression or "",
        anchor=anchor.isoformat() if anchor else None,
    )


def normalize_known_time(expression: str | None, anchor: date | None) -> TimeInterval:
    reference = anchor or date(1970, 1, 1)
    text = (expression or "").strip()
    lower = text.casefold()
    earliest, latest = reference - timedelta(days=365), reference
    granularity: Granularity = "unknown"
    if anchor is None and not re.search(r"\b(?:19|20)\d{2}\b", text):
        return unknown_interval(text, anchor)
    quarter = re.fullmatch(r"(?:q([1-4])\s+(\d{4})|(\d{4})\s+q([1-4]))", lower)
    part = re.fullmatch(r"(?:(early|mid|late)\s+)?([a-z]+)(?:\s+(\d{4}))?", lower)
    relative = re.fullmatch(
        r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+"
        r"(day|week|month|year)s?\s+(later|earlier|ago)",
        lower,
    )
    bound = re.fullmatch(r"(before|after)\s+(.+)", lower)
    weekday = re.fullmatch(
        r"last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)", lower
    )
    if re.fullmatch(r"\d{4}", text):
        earliest, latest = date(int(text), 1, 1), date(int(text), 12, 31)
        granularity = "year"
    elif quarter:
        year = int(quarter[2] or quarter[3])
        month = (int(quarter[1] or quarter[4]) - 1) * 3 + 1
        earliest = date(year, month, 1)
        latest = earliest + relativedelta(months=3) - timedelta(days=1)
        granularity = "quarter"
    elif part and part[2] in MONTHS:
        year, month = int(part[3] or reference.year), MONTHS[part[2]]
        end = calendar.monthrange(year, month)[1]
        first, last = {"early": (1, 10), "mid": (11, 20), "late": (21, end)}.get(part[1], (1, end))
        earliest, latest = date(year, month, first), date(year, month, last)
        granularity = "month" if part[1] is None else "week"
    elif relative:
        count = int(relative[1]) if relative[1].isdigit() else NUMBERS[relative[1]]
        count *= 1 if relative[3] == "later" else -1
        earliest = latest = reference + relativedelta(**{relative[2] + "s": count})
        granularity = "day"
    elif lower in {"the following month", "next month", "last month"}:
        earliest = reference.replace(day=1) + relativedelta(
            months=-1 if lower == "last month" else 1
        )
        latest = earliest + relativedelta(months=1) - timedelta(days=1)
        granularity = "month"
    elif weekday:
        target = list(calendar.day_name).index(weekday[1].capitalize())
        earliest = latest = reference - timedelta(days=(reference.weekday() - target) % 7 or 7)
        granularity = "day"
    elif bound:
        inner = normalize_time(bound[2], anchor)
        if inner.granularity != "unknown":
            if bound[1] == "before":
                latest = inner.earliest - timedelta(days=1)
                earliest = date.min
            else:
                earliest = inner.latest + timedelta(days=1)
                latest = date.max
            granularity = "unknown"
    elif text:
        parsed = dateparser.parse(
            text,
            settings={
                "RELATIVE_BASE": datetime.combine(reference, datetime.min.time()),
                "PREFER_DATES_FROM": "past",
                "STRICT_PARSING": True,
            },
            languages=["en"],
        )
        if parsed:
            earliest = latest = parsed.date()
            granularity = "day"
        elif anchor is None:
            return unknown_interval(text, anchor)
    return TimeInterval(
        earliest=earliest,
        latest=latest,
        granularity=granularity,
        source_text=text,
        anchor=anchor.isoformat() if anchor else None,
    )
