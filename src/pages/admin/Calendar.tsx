import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { holdsCar } from "../../lib/rental";
import { dayStart } from "../../lib/stats";
import { useStore } from "../../store/store";

const DAY = 86_400_000;
const COL = 64; // px per day

/** Timeline of every car's rentals and servicing (like a hotel room chart). */
export function Calendar() {
  const { data } = useStore();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(-2);
  const [span, setSpan] = useState(14);
  const start = dayStart(Date.now()) + offset * DAY;
  const end = start + span * DAY;
  const now = Date.now();
  const days = Array.from({ length: span }, (_, i) => start + i * DAY);
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / DAY) * COL;
  const bookings = data.bookings.filter((b) => holdsCar(b) && Date.parse(b.pickupAt) < end && Date.parse(b.checkin?.at ?? b.returnAt) > start);

  return (
    <>
      <div className="page-head">
        <h1>Fleet calendar</h1>
        <span className="spacer" />
        <div className="row">
          <button className="btn btn-sm" onClick={() => setOffset(offset - 7)} aria-label="Previous week">
            ←
          </button>
          <button className="btn btn-sm" onClick={() => setOffset(-2)}>
            Today
          </button>
          <button className="btn btn-sm" onClick={() => setOffset(offset + 7)} aria-label="Next week">
            →
          </button>
          <select aria-label="Days shown" value={span} onChange={(e) => setSpan(Number(e.target.value))} style={{ width: "auto", marginTop: 0 }}>
            <option value={14}>2 weeks</option>
            <option value={28}>4 weeks</option>
          </select>
        </div>
      </div>
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--series-1)" }} /> Reserved
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--good)" }} /> On rent
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--muted)" }} /> Returned
        </span>
        <span>
          <i className="swatch cal-maint" /> Servicing
        </span>
      </div>

      <div className="cal" role="grid" aria-label="Bookings per car">
        <div className="cal-row cal-head">
          <div className="cal-car">Car</div>
          <div className="cal-track" style={{ width: span * COL }}>
            {days.map((d) => (
              <div key={d} className={`cal-day ${d === dayStart(now) ? "today" : ""}`} style={{ width: COL }}>
                {new Date(d).toLocaleDateString("en-US", { weekday: "short" })}
                <br />
                {new Date(d).getDate()}
              </div>
            ))}
          </div>
        </div>
        {data.classes.map((cls) => (
          <div key={cls.id}>
            <div className="cal-group">{cls.name}</div>
            {data.cars
              .filter((c) => c.classId === cls.id)
              .map((car) => (
                <div key={car.id} className="cal-row">
                  <div className="cal-car">
                    <strong>{car.plate}</strong>
                    <span className="muted small">
                      {car.make} {car.model}
                    </span>
                  </div>
                  <div className="cal-track" style={{ width: span * COL }}>
                    {days.map((d) => (
                      <div key={d} className={`cal-cell ${d === dayStart(now) ? "today" : ""}`} style={{ left: x(d), width: COL }} />
                    ))}
                    {now >= start && now < end && <div className="cal-now" style={{ left: x(now) }} />}
                    {data.maintenance
                      .filter((m) => m.carId === car.id && Date.parse(m.from) < end && Date.parse(m.to) > start)
                      .map((m) => (
                        <div key={m.id} className="cal-bar cal-maint" style={{ left: x(Date.parse(m.from)), width: Math.max(4, x(Date.parse(m.to)) - x(Date.parse(m.from))) }} title={m.reason}>
                          {m.reason}
                        </div>
                      ))}
                    {bookings
                      .filter((b) => b.carId === car.id)
                      .map((b) => {
                        const s = Date.parse(b.checkout?.at ?? b.pickupAt);
                        const e = b.status === "Active" ? Math.max(Date.parse(b.returnAt), now) : Date.parse(b.checkin?.at ?? b.returnAt);
                        const overdue = b.status === "Active" && Date.parse(b.returnAt) < now;
                        return (
                          <button
                            key={b.id}
                            className={`cal-bar st-${b.status.toLowerCase()} ${overdue ? "overdue" : ""}`}
                            style={{ left: x(s), width: Math.max(6, x(e) - x(s)) }}
                            title={`${b.ref} · ${b.driver.name}${overdue ? " · OVERDUE" : ""}`}
                            onClick={() => navigate(`/admin/bookings/${b.id}`)}
                          >
                            {b.driver.name.split(" ")[1] ?? b.driver.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}
