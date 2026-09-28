import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CarArt } from "../components/CarArt";
import { SearchForm, searchFromParams, searchToParams } from "../components/SearchForm";
import { useMoney } from "../components/ui";
import { fmtDateTime, fromLocalInput } from "../lib/format";
import { availableCars, quote, validateDates } from "../lib/rental";
import { useStore } from "../store/store";

export function Search() {
  const { data } = useStore();
  const fmt = useMoney();
  const [params] = useSearchParams();
  const v = searchFromParams(params, data.locations[0]?.id ?? "");
  const pickupAt = fromLocalInput(v.from);
  const returnAt = fromLocalInput(v.to);
  const error = validateDates(pickupAt, returnAt, Date.now());
  const loc = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "?";

  const results = useMemo(() => {
    if (error) return [];
    const req = { pickupAt, returnAt, pickupLocationId: v.pl, returnLocationId: v.rl };
    const free = availableCars(req, data);
    return data.classes.map((cls) => ({
      cls,
      count: free.filter((c) => c.classId === cls.id).length,
      q: quote({ ...req, cls, extras: [] }, data.settings),
    }));
  }, [data, error, pickupAt, returnAt, v.pl, v.rl]);

  return (
    <div className="container section">
      <div className="card" style={{ marginBottom: "1rem" }}>
        <SearchForm key={params.toString()} initial={v} compact />
      </div>
      {error ? (
        <div className="notice">{error}</div>
      ) : (
        <>
          <h1 style={{ fontSize: "1.4rem" }}>
            {results.filter((r) => r.count > 0).length} car types available
          </h1>
          <p className="muted">
            {loc(v.pl)}, {fmtDateTime(pickupAt)} → {loc(v.rl)}, {fmtDateTime(returnAt)} · {results[0]?.q.days} day{results[0]?.q.days === 1 ? "" : "s"}
            {v.pl !== v.rl && <> · one-way fee {fmt(data.settings.oneWayFeeCents)} included</>}
          </p>
          <div className="stack">
            {results.map(({ cls, count, q }) => (
              <div key={cls.id} className={`card result ${count === 0 ? "sold-out" : ""}`}>
                <div className="result-art">
                  <CarArt bodyType={cls.bodyType} colorHex={cls.colorHex} title={cls.example} />
                </div>
                <div>
                  <h2 style={{ margin: 0 }}>{cls.name}</h2>
                  <div className="muted small">{cls.example}</div>
                  <div className="spec-chips" style={{ marginTop: "0.4rem" }}>
                    <span className="badge">👤 {cls.seats}</span>
                    <span className="badge">🧳 {cls.bags}</span>
                    <span className="badge">{cls.transmission}</span>
                    {count > 0 && count <= 2 && <span className="badge badge-warn">Only {count} left</span>}
                  </div>
                </div>
                <div className="result-price">
                  {count > 0 ? (
                    <>
                      <div className="price">{fmt(q.totalCents)}</div>
                      <div className="muted small">
                        total incl. tax · {fmt(Math.round((q.baseCents - q.discountCents) / q.days))}/day
                        {q.discountPercent > 0 && <> · {q.discountPercent}% long-rental discount</>}
                      </div>
                      <Link className="btn btn-primary" to={`/book?${searchToParams(v)}&class=${cls.id}`}>
                        Select
                      </Link>
                    </>
                  ) : (
                    <span className="badge">Sold out for these dates</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
