import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CarArt } from "../components/CarArt";
import { searchFromParams, searchToParams } from "../components/SearchForm";
import { useMoney } from "../components/ui";
import { fmtDateTime, fromLocalInput } from "../lib/format";
import { availableCars, quote, validateDates, validateDriver, type BookingRequestErrors } from "../lib/rental";
import { useStore } from "../store/store";
import type { Driver, Quote } from "../types";

export function QuoteLines({ q }: { q: Quote }) {
  const fmt = useMoney();
  const rows: [string, number][] = [[`${q.days} day${q.days === 1 ? "" : "s"} × ${fmt(q.dailyRateCents)}`, q.baseCents]];
  if (q.discountCents) rows.push([`Long-rental discount (${q.discountPercent}%)`, -q.discountCents]);
  if (q.extrasCents) rows.push(["Extras", q.extrasCents]);
  if (q.youngDriverCents) rows.push(["Young driver fee", q.youngDriverCents]);
  if (q.oneWayFeeCents) rows.push(["One-way fee", q.oneWayFeeCents]);
  rows.push(["Tax", q.taxCents]);
  return (
    <div className="totals">
      {rows.map(([l, v]) => (
        <span key={l} style={{ display: "contents" }}>
          <span>{l}</span>
          <span>{v < 0 ? `−${fmt(-v)}` : fmt(v)}</span>
        </span>
      ))}
      <span className="grand">Total</span>
      <span className="grand">{fmt(q.totalCents)}</span>
      <span className="muted small">Refundable deposit held at pick-up</span>
      <span className="muted small">{fmt(q.depositCents)}</span>
    </div>
  );
}

export function Book() {
  const { data, createBooking } = useStore();
  const fmt = useMoney();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const v = searchFromParams(params, data.locations[0]?.id ?? "");
  const cls = data.classes.find((c) => c.id === params.get("class"));
  const pickupAt = fromLocalInput(v.from);
  const returnAt = fromLocalInput(v.to);
  const [extras, setExtras] = useState<string[]>([]);
  const [driver, setDriver] = useState<Driver>({ name: "", email: "", phone: "", licenseNo: "", dob: "" });
  const [errors, setErrors] = useState<BookingRequestErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);

  const dateError = validateDates(pickupAt, returnAt, Date.now());
  const req = { pickupAt, returnAt, pickupLocationId: v.pl, returnLocationId: v.rl };
  const available = cls && !dateError ? availableCars(req, data, cls.id).length : 0;
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "?";

  if (!cls || dateError || available === 0) {
    return (
      <div className="container section">
        <div className="card empty">
          <h1>That car isn't available</h1>
          <p className="muted">{dateError ?? "It may have just been booked. Please pick another option."}</p>
          <Link className="btn btn-primary" to={`/search?${searchToParams(v)}`}>
            Back to results
          </Link>
        </div>
      </div>
    );
  }

  const validDob = /^\d{4}-\d{2}-\d{2}$/.test(driver.dob) ? driver.dob : undefined;
  const q = quote({ ...req, cls, extras: data.extras.filter((e) => extras.includes(e.id)), driverDob: validDob }, data.settings);

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validateDriver(driver, pickupAt, data.settings);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!agree) {
      setSubmitError("Please accept the rental terms.");
      return;
    }
    const res = createBooking({ classId: cls!.id, ...req, extras, driver, source: "Web" });
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    navigate(`/booking/${res.value.ref}`, { state: { email: res.value.driver.email, justBooked: true } });
  }

  const field = (key: keyof Driver, label: string, type = "text", auto?: string) => (
    <label>
      {label}
      <input type={type} value={driver[key]} autoComplete={auto} aria-invalid={!!errors[key]} onChange={(e) => setDriver({ ...driver, [key]: e.target.value })} />
      {errors[key] && <div className="field-error">{errors[key]}</div>}
    </label>
  );

  return (
    <div className="container section">
      <Link to={`/search?${searchToParams(v)}`} className="small">
        ← Change car
      </Link>
      <h1 style={{ marginTop: "0.5rem" }}>Complete your booking</h1>
      <form className="detail-grid" onSubmit={submit} noValidate>
        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Extras</h2>
            {data.extras.map((x) => (
              <label key={x.id} className="check">
                <input type="checkbox" checked={extras.includes(x.id)} onChange={(e) => setExtras(e.target.checked ? [...extras, x.id] : extras.filter((id) => id !== x.id))} />
                {x.name} <span className="muted">· {fmt(x.perDayCents)}/day{x.maxCents ? `, max ${fmt(x.maxCents)}` : ""}</span>
              </label>
            ))}
          </section>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Main driver</h2>
            <div className="form-grid">
              {field("name", "Full name (as on licence)", "text", "name")}
              {field("email", "Email", "email", "email")}
              {field("phone", "Mobile", "tel", "tel")}
              {field("licenseNo", "Driving licence number")}
              {field("dob", "Date of birth", "date", "bday")}
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Drivers must be {data.settings.minDriverAge}+. Under {data.settings.youngDriverAge}s pay {fmt(data.settings.youngDriverFeePerDayCents)}/day. Bring your licence and a
              credit card in the driver's name.
            </p>
          </section>
        </div>

        <div className="stack">
          <section className="card stack">
            <div className="detail-media" style={{ padding: "0.6rem" }}>
              <CarArt bodyType={cls.bodyType} colorHex={cls.colorHex} />
            </div>
            <div>
              <strong>{cls.name}</strong> <span className="muted small">· {cls.example}</span>
            </div>
            <div className="small">
              <div>
                <strong>Pick-up:</strong> {loc(v.pl)}, {fmtDateTime(pickupAt)}
              </div>
              <div>
                <strong>Return:</strong> {loc(v.rl)}, {fmtDateTime(returnAt)}
              </div>
            </div>
            <QuoteLines q={q} />
          </section>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept the rental terms (free cancellation until {data.settings.freeCancellationHours} h before pick-up;
            full-to-full fuel).
          </label>
          {submitError && (
            <div className="notice" role="alert">
              {submitError}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit">
            Book now · {fmt(q.totalCents)}
          </button>
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>
            Pay at the counter. Nothing is charged online in this demo.
          </p>
        </div>
      </form>
    </div>
  );
}
