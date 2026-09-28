import { useState, type FormEvent } from "react";
import { useStore } from "../store/store";
import { BookingView } from "./Confirmation";

export function Manage() {
  const { data } = useStore();
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const [foundId, setFoundId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const found = data.bookings.find((b) => b.id === foundId);

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = `RC-${ref.trim().toUpperCase().replace(/^RC-?/, "")}`;
    const b = data.bookings.find((x) => x.ref === r && x.driver.email === email.trim().toLowerCase());
    // Same message whether the reference or the email is wrong, so bookings can't be probed.
    if (!b) setErr("We couldn't find a booking with that reference and email.");
    else {
      setErr("");
      setFoundId(b.id);
    }
  }

  if (found) return <BookingView booking={found} />;
  return (
    <div className="container section" style={{ maxWidth: 520 }}>
      <form className="card stack" onSubmit={submit} noValidate>
        <h1 style={{ margin: 0 }}>Find my booking</h1>
        <label>
          Booking reference
          <input placeholder="RC-XXXXXX" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {err && <div className="field-error">{err}</div>}
        <button className="btn btn-primary" type="submit">
          Find booking
        </button>
      </form>
    </div>
  );
}
