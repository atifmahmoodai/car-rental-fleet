import { useEffect, useRef, useState, type FormEvent } from "react";
import { isRentalData, useStore } from "../../store/store";
import type { Settings } from "../../types";

const toCents = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s) * 100) : NaN);
const fromCents = (c: number) => (c / 100).toFixed(2);

const MONEY_FIELDS: [keyof Settings, string][] = [
  ["youngDriverFeePerDayCents", "Young driver fee / day"],
  ["oneWayFeeCents", "One-way fee"],
  ["fuelChargePerEighthCents", "Fuel charge per 1/8 tank"],
];
const NUMBER_FIELDS: [keyof Settings, string, number, number][] = [
  ["taxPercent", "Tax %", 0, 50],
  ["weeklyDiscountPercent", "7+ day discount %", 0, 80],
  ["monthlyDiscountPercent", "28+ day discount %", 0, 90],
  ["bufferHours", "Cleaning buffer (hours)", 0, 24],
  ["graceMinutes", "Late-return grace (minutes)", 0, 240],
  ["minDriverAge", "Minimum driver age", 16, 30],
  ["youngDriverAge", "Young driver under", 16, 35],
  ["freeCancellationHours", "Free cancellation until (hours before)", 0, 168],
];

export function AdminSettings() {
  const { data, saveSettings, saveClass, replaceData, resetDemo } = useStore();
  const [s, setS] = useState<Settings>(data.settings);
  const [money, setMoney] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, { rate: string; deposit: string }>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setS(data.settings);
    setMoney(Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, fromCents(data.settings[k] as number)])));
  }, [data.settings]);
  useEffect(() => {
    setRates(Object.fromEntries(data.classes.map((c) => [c.id, { rate: fromCents(c.dailyRateCents), deposit: fromCents(c.depositCents) }])));
  }, [data.classes]);

  function save(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!s.name.trim()) errs.push("Business name is required.");
    for (const [k, label, min, max] of NUMBER_FIELDS) {
      const v = s[k] as number;
      if (!(Number.isFinite(v) && v >= min && v <= max)) errs.push(`${label} must be between ${min} and ${max}.`);
    }
    if (s.youngDriverAge < s.minDriverAge) errs.push("Young-driver age can't be below the minimum age.");
    for (const [k, label] of MONEY_FIELDS) if (!(toCents(money[k] ?? "") >= 0)) errs.push(`${label} must be an amount like 12.50.`);
    for (const c of data.classes) {
      const r = rates[c.id];
      if (!r || !(toCents(r.rate) > 0)) errs.push(`${c.name}: enter a daily rate above 0.`);
      if (!r || !(toCents(r.deposit) >= 0)) errs.push(`${c.name}: enter a deposit.`);
    }
    try {
      new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency });
    } catch {
      errs.push("Currency / locale isn't valid (e.g. USD / en-US, PKR / en-PK, AED / en-AE).");
    }
    setErrors(errs);
    if (errs.length) return;
    const next = { ...s, name: s.name.trim(), currency: s.currency.trim().toUpperCase() };
    for (const [k] of MONEY_FIELDS) (next as Record<string, unknown>)[k] = toCents(money[k]);
    saveSettings(next);
    for (const c of data.classes) saveClass({ ...c, dailyRateCents: toCents(rates[c.id].rate), depositCents: toCents(rates[c.id].deposit) });
    setMsg({ ok: true, text: "Saved. New prices apply to new bookings; existing bookings keep the price they were quoted." });
  }

  return (
    <>
      <div className="page-head">
        <h1>Prices &amp; settings</h1>
      </div>
      <form className="stack" onSubmit={save} noValidate>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Daily rates</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Daily rate</th>
                  <th>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {data.classes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name} <span className="muted small">· {c.example}</span>
                    </td>
                    <td>
                      <input
                        aria-label={`${c.name} daily rate`}
                        inputMode="decimal"
                        value={rates[c.id]?.rate ?? ""}
                        onChange={(e) => setRates({ ...rates, [c.id]: { ...rates[c.id], rate: e.target.value } })}
                        style={{ marginTop: 0, maxWidth: 140 }}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${c.name} deposit`}
                        inputMode="decimal"
                        value={rates[c.id]?.deposit ?? ""}
                        onChange={(e) => setRates({ ...rates, [c.id]: { ...rates[c.id], deposit: e.target.value } })}
                        style={{ marginTop: 0, maxWidth: 140 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Business &amp; rules</h2>
          <div className="form-grid">
            {(["name", "phone", "email", "currency", "locale"] as const).map((k) => (
              <label key={k}>
                {k[0].toUpperCase() + k.slice(1)}
                <input value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
              </label>
            ))}
            {NUMBER_FIELDS.map(([k, label]) => (
              <label key={k}>
                {label}
                <input type="number" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
              </label>
            ))}
            {MONEY_FIELDS.map(([k, label]) => (
              <label key={k}>
                {label}
                <input inputMode="decimal" value={money[k] ?? ""} onChange={(e) => setMoney({ ...money, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>
        {errors.length > 0 && (
          <div className="notice" role="alert">
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {errors.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <button className="btn btn-primary" type="submit">
            Save prices &amp; settings
          </button>
        </div>
      </form>

      <section className="card stack" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>Data</h2>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: `rental-backup-${new Date().toISOString().slice(0, 10)}.json` });
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Restore…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const parsed: unknown = JSON.parse(await f.text());
                if (!isRentalData(parsed)) throw new Error("That file isn't a rental backup.");
                replaceData(parsed);
                setMsg({ ok: true, text: `Restored ${parsed.bookings.length} bookings.` });
              } catch (err) {
                setMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't read that file." });
              }
            }}
          />
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm("Replace everything with fresh demo data?")) {
                resetDemo();
                setMsg({ ok: true, text: "Demo data regenerated." });
              }
            }}
          >
            Reset demo
          </button>
        </div>
      </section>
      {msg && (
        <div className={`notice ${msg.ok ? "notice-good" : ""}`} style={{ marginTop: "1rem" }}>
          {msg.text}
        </div>
      )}
    </>
  );
}
