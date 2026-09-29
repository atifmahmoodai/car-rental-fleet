import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFleet } from "../../api/auth";
import { api, ApiError, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import { FuelGauge, StatusBadge, useMoney } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { ageOn, settleReturn } from "../../lib/rental";
import type { Booking } from "../../types";
import { QuoteLines } from "../Book";

interface Detail {
  booking: Booking;
  options: { carId: string; reason: string | null }[];
  carStillOutOn: string[];
}

export function BookingDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["booking", id], queryFn: () => api<Detail>(`/staff/bookings/${encodeURIComponent(id!)}`), staleTime: 0 });
  if (q.isPending) return <p className="muted">Loading…</p>;
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="card empty">
        <h1>{missing ? "Booking not found" : "Couldn't load this booking"}</h1>
        {!missing && <p className="muted">{errorText(q.error)}</p>}
        <Link to="/admin/bookings" className="btn">
          All bookings
        </Link>
      </div>
    );
  }
  return <DetailView key={q.data.booking.id} detail={q.data} />;
}

function DetailView({ detail }: { detail: Detail }) {
  const fleet = useFleet();
  const qc = useQueryClient();
  const data = { ...CATALOG, cars: fleet.data?.cars ?? [] };
  const fmt = useMoney();
  const b = detail.booking;
  const car = data.cars.find((c) => c.id === b.carId);
  const [odo, setOdo] = useState(String(b?.checkout?.odometer ?? car?.odometer ?? 0));
  const [fuel, setFuel] = useState(8);
  const [damage, setDamage] = useState("");
  const [other, setOther] = useState("0");
  const [newCar, setNewCar] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const action = useMutation({
    mutationFn: ({ name, body }: { name: string; body?: unknown; done: string }) => api<Booking>(`/staff/bookings/${b.id}/${name}`, { method: "POST", body: body ?? {} }),
    onSuccess: (r, v) => {
      setMsg({ ok: true, text: v.done });
      // The return form starts from the reading taken at hand-over.
      setOdo(String(r.checkin?.odometer ?? r.checkout?.odometer ?? odo));
      setFuel(8);
      void qc.invalidateQueries({ queryKey: ["booking", b.id] });
      void qc.invalidateQueries({ queryKey: ["fleet"] });
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const run = (name: string, done: string, body?: unknown) => action.mutate({ name, body, done });

  if (!car) return <p className="muted">Loading…</p>;
  const now = Date.now();
  const loc = (lid: string) => data.locations.find((l) => l.id === lid)?.name ?? "?";
  const cls = data.classes.find((c) => c.id === b.classId);
  const extras = data.extras.filter((e) => b.extras.includes(e.id));
  const otherCents = Math.round(Number(other) * 100);
  const preview = b.status === "Active" ? settleReturn(b, { at: new Date(now).toISOString(), fuel, otherChargesCents: Number.isFinite(otherCents) ? otherCents : 0 }, data.settings, data.extras) : null;
  // Cars this booking could move to (the server checked each one against every booking).
  const free = new Set(detail.options.filter((o) => o.reason === null).map((o) => o.carId));
  const swapOptions = data.cars.filter((c) => free.has(c.id));

  return (
    <>
      <div className="page-head">
        <h1>{b.ref}</h1>
        <StatusBadge status={b.status} />
        {b.status === "Active" && Date.parse(b.returnAt) < now && <span className="badge badge-bad">⚠ Overdue</span>}
        <span className="spacer" />
        <Link to="/admin/bookings" className="btn btn-sm">
          All bookings
        </Link>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Rental</h2>
            <div className="small">
              <strong>Pick-up:</strong> {loc(b.pickupLocationId)}, {fmtDateTime(b.pickupAt)}
              {b.checkout && (
                <span className="muted">
                  {" "}
                  · out {fmtDateTime(b.checkout.at)}, {b.checkout.odometer.toLocaleString("en-US")} km, <FuelGauge eighths={b.checkout.fuel} />
                </span>
              )}
            </div>
            <div className="small">
              <strong>Return:</strong> {loc(b.returnLocationId)}, {fmtDateTime(b.returnAt)}
              {b.checkin && (
                <span className="muted">
                  {" "}
                  · back {fmtDateTime(b.checkin.at)}, {b.checkin.odometer.toLocaleString("en-US")} km, <FuelGauge eighths={b.checkin.fuel} />
                </span>
              )}
            </div>
            <div className="small">
              <strong>Car:</strong> {car.plate} · {car.make} {car.model} ({cls?.name})
            </div>
            <div className="small">
              <strong>Driver:</strong> {b.driver.name}, age {ageOn(b.driver.dob, b.pickupAt)} · licence {b.driver.licenseNo} ·{" "}
              <a href={`tel:${b.driver.phone.replace(/[^\d+]/g, "")}`}>{b.driver.phone}</a> · <a href={`mailto:${b.driver.email}`}>{b.driver.email}</a>
            </div>
            {extras.length > 0 && (
              <div className="small">
                <strong>Extras:</strong> {extras.map((e) => e.name).join(", ")}
              </div>
            )}
            <div className="muted small">
              Booked {fmtDateTime(b.createdAt)} via {b.source}
              {b.cancelledAt && <> · cancelled {fmtDateTime(b.cancelledAt)}</>}
            </div>
          </section>

          {b.status === "Reserved" && detail.carStillOutOn.length > 0 && (
            <div className="notice" role="alert">
              ⚠ {car.plate} is still out on booking {detail.carStillOutOn.join(", ")}. Move this booking to another car below before handing over.
            </div>
          )}
          {b.status === "Reserved" && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Hand over the car</h2>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label>
                  Odometer (km)
                  <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
                </label>
                <label>
                  Fuel (eighths)
                  <input type="number" min={0} max={8} value={fuel} onChange={(e) => setFuel(Number(e.target.value))} />
                </label>
              </div>
              <div className="row">
                <button className="btn btn-primary" disabled={action.isPending} onClick={() => run("checkout", "Car handed over.", { odometer: Number(odo), fuel })}>
                  Check out
                </button>
                {Date.parse(b.pickupAt) < now && (
                  <button className="btn" disabled={action.isPending} onClick={() => run("no-show", "Marked as no-show.")}>
                    Mark no-show
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (window.confirm("Cancel this booking?")) run("cancel", "Booking cancelled.");
                  }}
                >
                  Cancel booking
                </button>
              </div>
              <div className="row">
                <select aria-label="Move to another car" value={newCar} onChange={(e) => setNewCar(e.target.value)} style={{ width: "auto", marginTop: 0 }}>
                  <option value="">Move to another car…</option>
                  {swapOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.plate} · {c.make} {c.model} ({data.classes.find((k) => k.id === c.classId)?.name})
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm"
                  disabled={!newCar}
                  onClick={() => {
                    run("change-car", "Moved to another car.", { carId: newCar });
                    setNewCar("");
                  }}
                >
                  Move
                </button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                Moving to a car in another class keeps the price the customer booked.
              </p>
            </section>
          )}

          {b.status === "Active" && preview && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Return the car</h2>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label>
                  Odometer (km)
                  <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
                </label>
                <label>
                  Fuel (eighths)
                  <input type="number" min={0} max={8} value={fuel} onChange={(e) => setFuel(Number(e.target.value))} />
                </label>
                <label className="span-all">
                  Damage notes
                  <input value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="None" />
                </label>
                <label>
                  Other charges
                  <input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} />
                </label>
              </div>
              <div className="totals">
                <span>Booked total</span>
                <span>{fmt(b.quote.totalCents)}</span>
                <span>Late return ({preview.lateDays} extra day{preview.lateDays === 1 ? "" : "s"})</span>
                <span>{fmt(preview.lateCents)}</span>
                <span>Fuel ({Math.max(0, (b.checkout?.fuel ?? 8) - fuel)}/8 missing)</span>
                <span>{fmt(preview.fuelChargeCents)}</span>
                <span className="grand">Final total incl. tax</span>
                <span className="grand">{fmt(preview.finalTotalCents)}</span>
              </div>
              <div>
                <button
                  className="btn btn-primary"
                  disabled={action.isPending || !Number.isFinite(otherCents) || otherCents < 0}
                  onClick={() => run("checkin", "Car returned.", { odometer: Number(odo), fuel, damage, otherChargesCents: otherCents })}
                >
                  Check in
                </button>
              </div>
            </section>
          )}

          {msg && (
            <div className={`notice ${msg.ok ? "notice-good" : ""}`} role="status">
              {msg.text}
            </div>
          )}
        </div>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>Charges</h2>
          <QuoteLines q={b.quote} />
          {b.checkin && (
            <div className="totals">
              <span>Late days</span>
              <span>{b.checkin.lateDays}</span>
              <span>Fuel charge</span>
              <span>{fmt(b.checkin.fuelChargeCents)}</span>
              <span>Other</span>
              <span>{fmt(b.checkin.otherChargesCents)}</span>
              <span className="grand">Final</span>
              <span className="grand">{fmt(b.checkin.finalTotalCents)}</span>
              {b.checkin.damage && (
                <>
                  <span>Damage</span>
                  <span>{b.checkin.damage}</span>
                </>
              )}
            </div>
          )}
          {b.status === "Cancelled" && <div className="notice">Cancellation fee: {fmt(b.cancellationFeeCents ?? 0)}</div>}
        </section>
      </div>
    </>
  );
}
