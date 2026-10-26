const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDay(iso: string) {
  return dayFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function formatShortDay(iso: string) {
  return shortDayFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function formatInterval(earliest: string, latest: string) {
  if (earliest === latest) return formatDay(earliest);
  return `${formatShortDay(earliest)} – ${formatDay(latest)}`;
}

export function formatDateTime(iso: string) {
  const date = new Date(iso);
  return `${dayFormat.format(date)}, ${timeFormat.format(date)} UTC`;
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function truncateMiddle(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function percent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function metadataLabel(field: string) {
  const last = field.split("/").pop() ?? field;
  const bare = last.replace(/^[a-z0-9]+:/i, "");
  return bare
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase()
    .replace(/\b(ip|id|mime|gps|xmp|dkim)\b/g, (word) => word.toUpperCase());
}

const revealing =
  /creator|author|modified|company|manager|owner|originating|received|gps|location|user|revision|from/i;

export function revealingFirst<T extends { field: string }>(fields: T[]) {
  return [...fields].sort(
    (a, b) => Number(revealing.test(b.field)) - Number(revealing.test(a.field)),
  );
}
