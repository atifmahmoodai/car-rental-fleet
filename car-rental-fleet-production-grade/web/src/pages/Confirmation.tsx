import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError, errorText } from "../api/client";
import { StatusBadge, useMoney } from "../components/ui";
import { CATALOG } from "../config";
import { fmtDateTime } from "../lib/format";
import { canCancelFree } from "../lib/rental";
import type { PublicBooking } from "../../../shared/schemas";
import { QuoteLines } from "./Book";

const lookup = (ref: string, email: string) => api<PublicBooking>("/public/bookings/lookup", { method: "POST", body: { ref, email } });

/** Customer-facing booking page. Needs the booking email (filled in automatically right after booking). */
export function Confirmation() {
  const { ref = "" } = useParams();
  const location = useLocation();
  const state = location.state as { email?: string; justBooked?: boolean } | null;
  const [email, setEmail] = useState(state?.email ?? "");
  const [submitted, setSubmitted] = useState(state?.email ?? "");
  const q = useQuery({ queryKey: ["my-booking", ref, submitted], queryFn: () => lookup(ref, submitted), enabled: !!submitted, retry: false });

  if (q.data) return <BookingView booking={q.data} email={submitted} justBooked={!!state?.justBooked} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(email.trim().toLowerCase());
  };
  return (
    <div className="container section" style={{ maxWidth: 520 }}>
      <form className="card stack" onSubmit={submit}>
        <h1 style={{ margin: 0 }}>Booking {ref}</h1>
        <label>
          Email used for the booking
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {q.isError && <div className="field-error">{errorText(q.error)}</div>}
        <button className="btn btn-primary" type="submit" disabled={q.isFetching}>
          {q.isFetching ? "Looking up…" : "Show booking"}
        </button>
        <Link to="/manage" className="small">
          Wrong reference? Find my booking
        </Link>
      </form>
    </div>
  );
}

export function BookingView({ booking, email, justBooked }: { booking: PublicBooking; email: string; justBooked?: boolean }) {
  const fmt = useMoney();
  const qc = useQueryClient();
  const [current, setCurrent] = useState(booking);
  const s = CATALOG.settings;
  const cls = CATALOG.classes.find((c) => c.id === current.classId);
  const loc = (id: string) => CATALOG.locations.find((l) => l.id === id);
  const free = canCancelFree(current as Parameters<typeof canCancelFree>[0], Date.now(), s);
  const extras = CATALOG.extras.filter((e) => current.extras.includes(e.id));
  const cancel = useMutation({
    mutationFn: () => api<PublicBooking>("/public/bookings/cancel", { method: "POST", body: { ref: current.ref, email } }),
    onSuccess: (b) => {
      setCurrent(b);
      void qc.invalidateQueries({ queryKey: ["my-booking"] });
    },
  });

  return (
    <div className="container section" style={{ maxWidth: 900 }}>
      {justBooked && (
        <div className="notice notice-good" role="status" style={{ marginBottom: "1rem" }}>
          <strong>You're booked!</strong> Your reference is <strong>{current.ref}</strong>. We've emailed the details to {current.driver.email}.
        </div>
      )}
      <div className="detail-grid">
        <section className="card stack">
          <div className="row">
            <h1 style={{ margin: 0 }}>{current.ref}</h1>
            <StatusBadge status={current.status} />
          </div>
          <div>
            <strong>{cls?.name}</strong> <span className="muted">· {cls?.example}</span>
          </div>
          <div className="small">
            <strong>Pick-up:</strong> {loc(current.pickupLocationId)?.name}, {fmtDateTime(current.pickupAt)}
            <br />
            <span className="muted">{loc(current.pickupLocationId)?.address}</span>
          </div>
          <div className="small">
            <strong>Return:</strong> {loc(current.returnLocationId)?.name}, {fmtDateTime(current.returnAt)}
          </div>
          <div className="small">
            <strong>Driver:</strong> {current.driver.name} · {current.driver.phone}
          </div>
          {extras.length > 0 && (
            <div className="small">
              <strong>Extras:</strong> {extras.map((e) => e.name).join(", ")}
            </div>
          )}
          {current.status === "Cancelled" && (
            <div className="notice">Cancelled{current.cancellationFeeCents ? `: a late-cancellation fee of ${fmt(current.cancellationFeeCents)} applies.` : " free of charge."}</div>
          )}
          {current.status === "Reserved" && (
            <div className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                {free
                  ? `Free cancellation until ${fmtDateTime(new Date(Date.parse(current.pickupAt) - s.freeCancellationHours * 3_600_000).toISOString())}.`
                  : `Pick-up is less than ${s.freeCancellationHours} hours away, so cancelling now costs one day's rental.`}
              </p>
              <div>
                <button
                  className="btn btn-danger"
                  disabled={cancel.isPending}
                  onClick={() => {
                    if (window.confirm(free ? "Cancel this booking?" : "Cancel and pay one day's rental?")) cancel.mutate();
                  }}
                >
                  Cancel booking
                </button>
              </div>
              {cancel.isError && <div className="field-error">{cancel.error instanceof ApiError ? cancel.error.message : errorText(cancel.error)}</div>}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Price</h2>
          <QuoteLines q={current.quote} />
        </section>
      </div>
    </div>
  );
}
