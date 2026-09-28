import { useMemo, useState, type FormEvent } from "react";
import { fmtDateTime, fmtPct, fromLocalInput } from "../../lib/format";
import { holdsCar, locationAt, utilisation } from "../../lib/rental";
import { actions, newId, useStore } from "../../store/store";
import type { Car } from "../../types";

const DAY = 86_400_000;

export function Fleet() {
  const { data, saveCar, run, removeMaintenance } = useStore();
  const now = Date.now();
  const [form, setForm] = useState<Car | null>(null);
  const [formErr, setFormErr] = useState<string[]>([]);
  const [m, setM] = useState({ carId: "", from: "", to: "", reason: "Scheduled service" });
  const [mMsg, setMMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const held = useMemo(() => data.bookings.filter(holdsCar), [data.bookings]);
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "?";

  const rows = useMemo(
    () =>
      data.cars.map((c) => {
        const active = data.bookings.find((b) => b.carId === c.id && b.status === "Active");
        const serv = data.maintenance.find((x) => x.carId === c.id && Date.parse(x.from) <= now && Date.parse(x.to) > now);
        const u = utilisation(data, new Date(now - 30 * DAY).toISOString(), new Date(now).toISOString(), new Set([c.id]));
        return { c, active, serv, at: locationAt(c, held, now), u: u.rate };
      }),
    [data, held, now],
  );

  function saveForm(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const errs: string[] = [];
    if (!form.plate.trim()) errs.push("Plate is required.");
    if (data.cars.some((c) => c.id !== form.id && c.plate.replace(/\s/g, "").toUpperCase() === form.plate.replace(/\s/g, "").toUpperCase())) errs.push("That plate is already in the fleet.");
    if (!form.make.trim() || !form.model.trim()) errs.push("Make and model are required.");
    if (!(form.year >= 2000 && form.year <= new Date().getFullYear() + 1)) errs.push("Check the year.");
    if (!(form.odometer >= 0)) errs.push("Odometer can't be negative.");
    setFormErr(errs);
    if (errs.length) return;
    saveCar({ ...form, plate: form.plate.trim().toUpperCase() });
    setForm(null);
  }

  function addMaint(e: FormEvent) {
    e.preventDefault();
    const from = fromLocalInput(m.from);
    const to = fromLocalInput(m.to);
    if (!m.carId || !from || !to) {
      setMMsg({ ok: false, text: "Choose a car, start and end." });
      return;
    }
    const err = run((d, t) => actions.addMaintenance(d, { id: newId("m"), carId: m.carId, from, to, reason: m.reason.trim() || "Maintenance" }, t));
    setMMsg(err ? { ok: false, text: err } : { ok: true, text: "Car blocked for maintenance." });
  }

  const upcomingMaint = data.maintenance.filter((x) => Date.parse(x.to) > now).sort((a, b) => a.from.localeCompare(b.from));

  return (
    <>
      <div className="page-head">
        <h1>Fleet</h1>
        <span className="muted">{data.cars.filter((c) => c.active).length} active cars</span>
        <span className="spacer" />
        <button
          className="btn btn-primary"
          onClick={() => {
            setFormErr([]);
            setForm({ id: newId("car"), plate: "", make: "", model: "", year: new Date().getFullYear(), classId: data.classes[0].id, homeLocationId: data.locations[0].id, odometer: 0, active: true });
          }}
        >
          + Add car
        </button>
      </div>

      {form && (
        <form className="card stack" onSubmit={saveForm} noValidate style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{data.cars.some((c) => c.id === form.id) ? `Edit ${form.plate}` : "New car"}</h2>
          <div className="form-grid">
            <label>
              Plate
              <input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
            </label>
            <label>
              Make
              <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </label>
            <label>
              Model
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </label>
            <label>
              Year
              <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
            </label>
            <label>
              Class
              <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Home location
              <select value={form.homeLocationId} onChange={(e) => setForm({ ...form, homeLocationId: e.target.value })}>
                {data.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Odometer (km)
              <input type="number" min={0} value={form.odometer} onChange={(e) => setForm({ ...form, odometer: Number(e.target.value) })} />
            </label>
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for rent
            </label>
          </div>
          {formErr.map((er) => (
            <div key={er} className="field-error">
              {er}
            </div>
          ))}
          {!form.active && data.bookings.some((b) => b.carId === form.id && b.status === "Reserved") && (
            <div className="notice">This car has upcoming bookings. Move them to other cars from each booking's page before retiring it.</div>
          )}
          <div className="row">
            <button className="btn btn-primary btn-sm" type="submit">
              Save car
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Car</th>
              <th>Class</th>
              <th>Now</th>
              <th className="r">Odometer</th>
              <th>30-day utilisation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, active, serv, at, u }) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.plate}</strong>
                </td>
                <td>
                  {c.year} {c.make} {c.model}
                </td>
                <td>{data.classes.find((k) => k.id === c.classId)?.name}</td>
                <td>
                  {!c.active ? (
                    <span className="badge">Retired</span>
                  ) : active ? (
                    <span className="badge badge-good">On rent · back {fmtDateTime(active.returnAt)}</span>
                  ) : serv ? (
                    <span className="badge badge-warn">In service · {serv.reason}</span>
                  ) : (
                    <span className="badge badge-brand">Ready at {loc(at)}</span>
                  )}
                </td>
                <td className="r">{c.odometer.toLocaleString("en-US")}</td>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <div className="meter" style={{ flex: 1, minWidth: 60 }}>
                      <span style={{ width: `${Math.min(100, u * 100)}%` }} />
                    </div>
                    <span className="num small">{fmtPct(u)}</span>
                  </div>
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => { setFormErr([]); setForm({ ...c }); }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card stack" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>Maintenance</h2>
        <form className="form-grid" onSubmit={addMaint} noValidate>
          <label>
            Car
            <select value={m.carId} onChange={(e) => setM({ ...m, carId: e.target.value })}>
              <option value="">Choose…</option>
              {data.cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.plate} · {c.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="datetime-local" value={m.from} onChange={(e) => setM({ ...m, from: e.target.value })} />
          </label>
          <label>
            To
            <input type="datetime-local" value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} />
          </label>
          <label>
            Reason
            <input value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} />
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn btn-primary" type="submit">
              Block car
            </button>
          </div>
        </form>
        {mMsg && <div className={`notice ${mMsg.ok ? "notice-good" : ""}`}>{mMsg.text}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Car</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {upcomingMaint.map((x) => (
                <tr key={x.id}>
                  <td>{data.cars.find((c) => c.id === x.carId)?.plate}</td>
                  <td>{fmtDateTime(x.from)}</td>
                  <td>{fmtDateTime(x.to)}</td>
                  <td>{x.reason}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => removeMaintenance(x.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {upcomingMaint.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No current or upcoming maintenance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
