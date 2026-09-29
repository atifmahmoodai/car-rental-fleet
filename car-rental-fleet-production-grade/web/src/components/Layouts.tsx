import { Suspense } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { isAdmin, useFleet, useLogout, useMe } from "../api/auth";
import { errorText } from "../api/client";
import { CATALOG } from "../config";

function Logo() {
  return (
    <>
      <img src="/favicon.svg" alt="" width={30} height={30} />
      <span>{CATALOG.settings.name}</span>
    </>
  );
}

export function PublicLayout() {
  const s = CATALOG.settings;
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="logo">
            <Logo />
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end className={({ isActive }) => `nav-home${isActive ? " active" : ""}`}>
              Book a car
            </NavLink>
            <NavLink to="/manage">My booking</NavLink>
            <NavLink to="/admin">Staff</NavLink>
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          {CATALOG.locations.map((l) => (
            <div key={l.id}>
              <h3>{l.name}</h3>
              <p className="muted small">
                {l.address}
                <br />
                Open daily 08:00–19:00
              </p>
            </div>
          ))}
          <div>
            <h3>Contact</h3>
            <p className="muted small">
              <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}>{s.phone}</a>
              <br />
              <a href={`mailto:${s.email}`}>{s.email}</a>
            </p>
          </div>
        </div>
        <div className="container muted small" style={{ marginTop: "1rem" }}>
          Times are local to our desks ({CATALOG.timeZone.replace(/_/g, " ")}).
        </div>
      </footer>
    </>
  );
}

export function AdminLayout() {
  const me = useMe();
  const fleet = useFleet(!!me.data);
  const logout = useLogout();
  const location = useLocation();

  if (me.isPending) return <p className="muted" style={{ padding: "2rem" }}>Loading…</p>;
  if (me.isError) return <p className="field-error" style={{ padding: "2rem" }}>{errorText(me.error)}</p>;
  if (!me.data) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (fleet.isPending) return <p className="muted" style={{ padding: "2rem" }}>Loading…</p>;
  if (fleet.isError) {
    return (
      <div className="card empty" style={{ margin: "2rem" }}>
        <h1>Couldn't load the fleet</h1>
        <p className="muted">{errorText(fleet.error)}</p>
        <button className="btn btn-primary" onClick={() => void fleet.refetch()}>
          Retry
        </button>
      </div>
    );
  }
  const user = me.data;
  return (
    <div className="admin-shell">
      <aside className="admin-side" aria-label="Staff menu">
        <NavLink to="/admin" end className="logo" style={{ padding: "0.2rem 0.5rem 0.8rem" }}>
          <Logo />
        </NavLink>
        <NavLink to="/admin" end className="side-link">
          Dashboard
        </NavLink>
        <NavLink to="/admin/calendar" className="side-link">
          Fleet calendar
        </NavLink>
        <NavLink to="/admin/bookings" className="side-link">
          Bookings {fleet.data.overdue > 0 && <span className="badge badge-bad count">{fleet.data.overdue} overdue</span>}
        </NavLink>
        <NavLink to="/admin/fleet" className="side-link">
          Fleet
        </NavLink>
        {isAdmin(user) && (
          <>
            <NavLink to="/admin/settings" className="side-link">
              Prices, settings &amp; users
            </NavLink>
            <NavLink to="/admin/audit" className="side-link">
              Activity log
            </NavLink>
          </>
        )}
        <NavLink to="/" className="side-link">
          ← Booking site
        </NavLink>
        <div className="side-extra side-user small" style={{ marginTop: "auto" }}>
          <div>
            <strong>{user.name}</strong> <span className="muted">({user.role})</span>
          </div>
          <div className="row" style={{ gap: "0.4rem", marginTop: "0.4rem" }}>
            <NavLink to="/admin/account" className="btn btn-sm">
              My account
            </NavLink>
            <button className="btn btn-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
