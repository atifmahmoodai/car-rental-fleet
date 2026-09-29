import type { Queryable } from "../db";
import { HttpError } from "../http";
import { fmtDateTime } from "../../../shared/format";
import { audit, loadData, persistChanges } from "../repo/data";
import type { Result } from "../../../shared/actions";
import type { Booking, Car, Maintenance, RentalData, Settings } from "../../../shared/types";

/**
 * Runs a shared booking action on the rows loaded (and locked) for this request, saves what it
 * changed and records it in the audit log. Returns the booking afterwards.
 */
export async function runBookingAction(
  c: Queryable,
  parts: { cars: Car[]; bookings: Booking[]; maintenance?: Maintenance[] },
  fn: (d: RentalData, now: number) => Result<RentalData>,
  log: { userId: string | null; action: string; ip: string; bookingId: string; details?: Record<string, unknown> },
): Promise<Booking> {
  const before = await loadData(c, parts);
  const res = fn(before, Date.now());
  if (!res.ok) throw new HttpError(409, res.error, "rejected");
  await persistChanges(c, before, res.value);
  await audit(c, { userId: log.userId, action: log.action, entity: "booking", entityId: log.bookingId, details: log.details, ip: log.ip });
  return res.value.bookings.find((b) => b.id === log.bookingId)!;
}

const money = (cents: number, s: Settings) => new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency }).format(cents / 100);
// Desk time zone, set at start-up, so the email shows the time the customer booked.
const when = (iso: string) => fmtDateTime(iso);

export function bookingEmail(b: Booking, s: Settings, link: string): string {
  return [
    `Hi ${b.driver.name},`,
    "",
    `Your booking ${b.ref} is confirmed.`,
    `Pick-up: ${when(b.pickupAt)}`,
    `Return: ${when(b.returnAt)}`,
    `Total: ${money(b.quote.totalCents, s)} (pay at the counter). Refundable deposit: ${money(b.quote.depositCents, s)}.`,
    "",
    `Free cancellation until ${s.freeCancellationHours} hours before pick-up. Manage your booking: ${link}`,
    "Bring your driving licence and a credit card in the driver's name.",
    "",
    `${s.name} · ${s.phone}`,
  ].join("\n");
}
