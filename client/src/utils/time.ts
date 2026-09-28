const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "2-digit",
});
const longDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysApart(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

export function sidebarTimestamp(iso: string): string {
  const date = new Date(iso);
  const days = daysApart(date, new Date());
  if (days === 0) return timeFmt.format(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFmt.format(date);
  return dateFmt.format(date);
}

export function separatorParts(iso: string): { day: string; time: string } {
  const date = new Date(iso);
  const days = daysApart(date, new Date());
  let day: string;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Yesterday";
  else if (days < 7) day = weekdayFmt.format(date);
  else day = longDateFmt.format(date);
  return { day, time: timeFmt.format(date) };
}

export function bubbleTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
