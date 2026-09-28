import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { StatusBadge, useMoney } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { canCancelFree } from "../lib/rental";
import { actions, useStore } from "../store/store";
import type { Booking } from "../types";
import { QuoteLines } from "./Book";

/** Customer-facing booking view. Requires the booking email unless we just created it in this tab. */
export function Confirmation() {
  const { ref } = useParams();
  const location = useLocation();
  const state = location.state as { email?: string; justBooked?: boolean } | null;
  const { data } = useStore();
  const booking = data.bookings.find((b) => b.ref === ref);
  const [email, setEmail] = useState(state?.email ?? "");
  const [unlocked, setUnlocked] = useState(!!state?.email && booking?.driver.email === state.email);
  const [err, setErr] = useState("");

  if (!booking) {
    return (
      <div className="container section">
        <div className="card empty">
          <h1>Booking not found</h1>
          <Link to="/manage" className="btn">
            Find my booking
          </Link>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (email.trim().toLowerCase() === booking.driver.email) setUnlocked(true);
      else setErr("That email doesn't match this booking.");
    };
    return (
      <div className="container section" style={{ maxWidth: 520 }}>
        <form className="card stack" onSubmit={submit}>
          <h1 style={{ margin: 0 }}>Booking {booking.ref}</h1>
          <label>
            Email used for the booking
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {err && <div className="field-error">{err}</div>}
          <button className="btn btn-primary" type="submit">
            Show booking
          </button>
        </form>
      </div>
    );
  }
  return <BookingView booking={booking} justBooked={!!state?.justBooked} />;
}

export function BookingView({ booking, justBooked }: { booking: Booking; justBooked?: boolean }) {
  const { data, run } = useStore();
  const fmt = useMoney();
  const [msg, setMsg] = useState<string | null>(null);
  const cls = data.classes.find((c) => c.id === booking.classId);
  const loc = (id: string) => data.locations.find((l) => l.id === id);
  const free = canCancelFree(booking, Date.now(), data.settings);
  const extras = data.extras.filter((e) => booking.extras.includes(e.id));

  return (
    <div className="container section" style={{ maxWidth: 900 }}>
      {justBooked && (
        <div className="notice notice-good" role="status" style={{ marginBottom: "1rem" }}>
          <strong>You're booked!</strong> Your reference is <strong>{booking.ref}</strong>. We've sent the details to {booking.driver.email}.
        </div>
      )}
      <div className="detail-grid">
        <section className="card stack">
          <div className="row">
            <h1 style={{ margin: 0 }}>{booking.ref}</h1>
            <StatusBadge status={booking.status} />
          </div>
          <div>
            <strong>{cls?.name}</strong> <span className="muted">· {cls?.example}</span>
          </div>
          <div className="small">
            <strong>Pick-up:</strong> {loc(booking.pickupLocationId)?.name}, {fmtDateTime(booking.pickupAt)}
            <br />
            <span className="muted">{loc(booking.pickupLocationId)?.address}</span>
          </div>
          <div className="small">
            <strong>Return:</strong> {loc(booking.returnLocationId)?.name}, {fmtDateTime(booking.returnAt)}
          </div>
          <div className="small">
            <strong>Driver:</strong> {booking.driver.name} · {booking.driver.phone}
          </div>
          {extras.length > 0 && (
            <div className="small">
              <strong>Extras:</strong> {extras.map((e) => e.name).join(", ")}
            </div>
          )}
          {booking.status === "Cancelled" && (
            <div className="notice">
              Cancelled{booking.cancellationFeeCents ? `: a late-cancellation fee of ${fmt(booking.cancellationFeeCents)} applies.` : " free of charge."}
            </div>
          )}
          {booking.status === "Reserved" && (
            <div className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                {free
                  ? `Free cancellation until ${fmtDateTime(new Date(Date.parse(booking.pickupAt) - data.settings.freeCancellationHours * 3_600_000).toISOString())}.`
                  : `Pick-up is less than ${data.settings.freeCancellationHours} hours away, so cancelling now costs one day's rental.`}
              </p>
              <div>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    if (!window.confirm(free ? "Cancel this booking?" : "Cancel and pay one day's rental?")) return;
                    setMsg(run((d, now) => actions.cancel(d, booking.id, now)));
                  }}
                >
                  Cancel booking
                </button>
              </div>
              {msg && <div className="field-error">{msg}</div>}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Price</h2>
          <QuoteLines q={booking.quote} />
        </section>
      </div>
    </div>
  );
}
