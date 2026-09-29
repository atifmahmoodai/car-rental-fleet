import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFleet } from "../../api/auth";
import { api, errorText } from "../../api/client";
import { CATALOG } from "../../config";
import { getDeskTimeZone } from "../../lib/format";
import { dayStart } from "../../lib/stats";
import type { Booking, Maintenance } from "../../types";

const DAY = 86_400_000;
const COL = 64; // px per day

/** Timeline of every car's rentals and servicing (like a hotel room chart). */
export function Calendar() {
  const fleet = useFleet();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(-2);
  const [span, setSpan] = useState(14);
  const now = Date.now();
  // Whole desk-time days (a 3-hour nudge keeps each step on the next date across daylight-saving changes).
  const start = dayStart(dayStart(now) + offset * DAY + 3 * 3_600_000);
  const days = Array.from({ length: span }, (_, i) => dayStart(start + i * DAY + 3 * 3_600_000));
  const end = dayStart(start + span * DAY + 3 * 3_600_000);
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / (end - start)) * span * COL;
  const q = useQuery({
    queryKey: ["calendar", start, end],
    queryFn: () => api<{ bookings: Booking[]; maintenance: Maintenance[] }>(`/staff/calendar?from=${start}&to=${end}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = { ...CATALOG, cars: fleet.data?.cars ?? [], maintenance: q.data?.maintenance ?? [] };
  const bookings = q.data?.bookings ?? [];
  const tz = getDeskTimeZone();

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

      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      <div className="cal" role="grid" aria-label="Bookings per car">
        <div className="cal-row cal-head">
          <div className="cal-car">Car</div>
          <div className="cal-track" style={{ width: span * COL }}>
            {days.map((d) => (
              <div key={d} className={`cal-day ${d === dayStart(now) ? "today" : ""}`} style={{ width: COL }}>
                {new Date(d).toLocaleDateString("en-US", { weekday: "short", timeZone: tz })}
                <br />
                {new Date(d).toLocaleDateString("en-US", { day: "numeric", timeZone: tz })}
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
