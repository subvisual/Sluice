/**
 * Deadline display for positions. All times are unix seconds; everything
 * renders in UTC (the venue's clock), never the browser's locale.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-07-31 · 14:00 UTC" */
export function formatDeadlineAbs(unix: number) {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "Jul 22" */
export function formatDayShort(unix: number) {
  const d = new Date(unix * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export type CountdownTone = "ok" | "warn" | "muted";

/**
 * "5d 12h left" · "18h left" · "expired 2d ago". Tone turns `warn` under 24h —
 * the card's visual cue that the unwind is close.
 */
export function countdown(
  deadline: number,
  now: number,
): { label: string; tone: CountdownTone } {
  const diff = deadline - now;
  if (diff <= 0) {
    const days = Math.floor(-diff / 86_400);
    return {
      label: days < 1 ? "expired today" : `expired ${days}d ago`,
      tone: "muted",
    };
  }
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  const label =
    days > 0
      ? `${days}d ${hours}h left`
      : hours > 0
        ? `${hours}h left`
        : `${Math.max(1, Math.floor(diff / 60))}m left`;
  return { label, tone: diff < 86_400 ? "warn" : "ok" };
}
