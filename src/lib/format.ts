import type { Settings } from "../types";

const cache = new Map<string, Intl.NumberFormat>();
export function money(cents: number, s: Pick<Settings, "locale" | "currency">): string {
  const k = `${s.locale}|${s.currency}`;
  if (!cache.has(k)) {
    try {
      cache.set(k, new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency }));
    } catch {
      cache.set(k, new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }));
    }
  }
  return cache.get(k)!.format((Number.isFinite(cents) ? cents : 0) / 100);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → value for <input type="datetime-local"> in the viewer's timezone. */
export function toLocalInput(iso: string | number): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO (interpreted as local time). Empty/invalid → "". */
export function fromLocalInput(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "";
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export const fmtPct = (r: number, digits = 0) => `${(Number.isFinite(r) ? r * 100 : 0).toFixed(digits)}%`;

/** Next whole hour + `days`, at `hour` local time. */
export function defaultTime(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.getTime());
}
