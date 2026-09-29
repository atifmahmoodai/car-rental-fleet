import type { Settings } from "./types";

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

// Pick-up and return times belong to the rental desks, not to the visitor's device: someone booking
// from abroad for "10:00" means 10:00 at the airport desk. Every time shown or typed uses this zone.
let deskTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const setDeskTimeZone = (tz: string) => {
  deskTimeZone = tz;
  partsFmt = null;
};
export const getDeskTimeZone = () => deskTimeZone;

let partsFmt: Intl.DateTimeFormat | null = null;
/** Calendar fields of instant `t` in the desk time zone. */
function zoned(t: number) {
  partsFmt ??= new Intl.DateTimeFormat("en-US", {
    timeZone: deskTimeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** The instant at which the desk's wall clock shows the given date and time (handles daylight-saving changes). */
export function zonedToUtc(y: number, mo: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const z = zoned(t);
    return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - t;
  };
  const first = guess - offset(guess);
  const second = guess - offset(first);
  return second;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant → value for <input type="datetime-local">, in the desk time zone. */
export function toLocalInput(iso: string | number): string {
  const z = zoned(new Date(iso).getTime());
  return `${z.y}-${pad(z.mo)}-${pad(z.d)}T${pad(z.h)}:${pad(z.mi)}`;
}

/** <input type="datetime-local"> value (desk time) → ISO instant. Empty/invalid → "". */
export function fromLocalInput(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return "";
  const t = zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: deskTimeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: deskTimeZone, month: "short", day: "numeric", year: "numeric" });
}
export const fmtPct = (r: number, digits = 0) => `${(Number.isFinite(r) ? r * 100 : 0).toFixed(digits)}%`;

/** `days` from today at `hour` o'clock, desk time. */
export function defaultTime(days: number, hour: number): string {
  const z = zoned(Date.now());
  const t = zonedToUtc(z.y, z.mo, z.d + days, hour);
  return toLocalInput(t);
}

/** Midnight (desk time) at the start of the day containing t. */
export function deskDayStart(t: number): number {
  const z = zoned(t);
  return zonedToUtc(z.y, z.mo, z.d);
}
