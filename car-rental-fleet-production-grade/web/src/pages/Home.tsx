import { CarArt } from "../components/CarArt";
import { SearchForm } from "../components/SearchForm";
import { useMoney } from "../components/ui";
import { CATALOG } from "../config";

export function Home() {
  const fmt = useMoney();
  const s = CATALOG.settings;
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Rent a car in minutes</h1>
          <p className="lead">
            Pick up at the airport or in the city. Free cancellation up to {s.freeCancellationHours} hours before pick-up, and no hidden fees.
          </p>
          <div className="card" style={{ marginTop: "1rem" }}>
            <SearchForm />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Our cars</h2>
          <div className="grid-cards">
            {CATALOG.classes.map((c) => (
              <div key={c.id} className="vcard">
                <div className="vcard-media">
                  <CarArt bodyType={c.bodyType} colorHex={c.colorHex} title={c.example} />
                </div>
                <div className="vcard-body">
                  <div className="vcard-title">{c.name}</div>
                  <div className="muted small">{c.example}</div>
                  <div className="spec-chips">
                    <span className="badge">👤 {c.seats} seats</span>
                    <span className="badge">🧳 {c.bags} bags</span>
                    <span className="badge">{c.transmission}</span>
                  </div>
                  <div>
                    from <span className="vcard-price">{fmt(c.dailyRateCents)}</span> <span className="muted small">/ day</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container why-grid">
          {[
            ["Weekly & monthly deals", `${s.weeklyDiscountPercent}% off rentals of 7+ days, ${s.monthlyDiscountPercent}% off 28+ days.`],
            ["Free cancellation", `Cancel for free until ${s.freeCancellationHours} hours before pick-up.`],
            ["One-way rentals", `Pick up at one location and return at the other for ${fmt(s.oneWayFeeCents)}.`],
            ["Full-to-full fuel", "Get the car full and return it full. You only pay for fuel you use."],
          ].map(([t, d]) => (
            <div key={t} className="card">
              <h3>{t}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {d}
              </p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
