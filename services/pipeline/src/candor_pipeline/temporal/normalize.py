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


def nearest_date(reference: date, candidates: list[tuple[int, int, int]]) -> date:
    options = []
    for year, month, day in candidates:
        try:
            options.append(date(year, month, day))
        except ValueError:
            continue
    if not options:
        raise ValueError("invalid_calendar_date")
    return min(options, key=lambda value: (abs((value - reference).days), value))


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
        r"(?:(last|next|this|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
        lower,
    )
    month_day = re.fullmatch(
        r"(?:(?:on\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
        r"|(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)\.?)",
        lower,
    )
    day_only = re.fullmatch(r"(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)", lower)
    if re.fullmatch(r"\d{4}", text):
        earliest, latest = date(int(text), 1, 1), date(int(text), 12, 31)
        granularity = "year"
    elif month_day and (month_day[1] or month_day[4]) in MONTHS and anchor is not None:
        month = MONTHS[month_day[1] or month_day[4]]
        day = int(month_day[2] or month_day[3])
        earliest = latest = nearest_date(
            reference, [(reference.year + offset, month, day) for offset in (-1, 0, 1)]
        )
        granularity = "day"
    elif day_only and anchor is not None:
        months = [reference.replace(day=1) + relativedelta(months=offset) for offset in (-1, 0, 1)]
        earliest = latest = nearest_date(
            reference, [(value.year, value.month, int(day_only[1])) for value in months]
        )
        granularity = "day"
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
        target = list(calendar.day_name).index(weekday[2].capitalize())
        back, ahead = (reference.weekday() - target) % 7, (target - reference.weekday()) % 7
        if weekday[1] == "last":
            offset = -(back or 7)
        elif weekday[1] == "next":
            offset = ahead or 7
        else:
            offset = ahead if ahead <= back else -back
        earliest = latest = reference + timedelta(days=offset)
        granularity = "day"
    elif bound:
        words = bound[2].split()
        inner = unknown_interval(bound[2], anchor)
        for start in range(len(words)):
            inner = normalize_time(" ".join(words[start:]), anchor)
            if inner.granularity != "unknown":
                break
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
