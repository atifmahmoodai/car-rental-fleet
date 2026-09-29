import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, errorText } from "../api/client";
import type { PublicBooking } from "../../../shared/schemas";
import { BookingView } from "./Confirmation";

export function Manage() {
  const [ref, setRef] = useState("");
  const [email, setEmail] = useState("");
  const find = useMutation({
    mutationFn: (body: { ref: string; email: string }) => api<PublicBooking>("/public/bookings/lookup", { method: "POST", body }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    find.mutate({ ref: `RC-${ref.trim().toUpperCase().replace(/^RC-?/, "")}`, email: email.trim().toLowerCase() });
  }

  if (find.data) return <BookingView booking={find.data} email={email.trim().toLowerCase()} />;
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
        {/* The server answers the same way whether the reference or the email is wrong, so bookings can't be probed. */}
        {find.isError && <div className="field-error">{errorText(find.error)}</div>}
        <button className="btn btn-primary" type="submit" disabled={find.isPending}>
          {find.isPending ? "Looking up…" : "Find booking"}
        </button>
      </form>
    </div>
  );
}
