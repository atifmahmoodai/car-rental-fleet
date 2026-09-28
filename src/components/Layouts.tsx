import { Link, NavLink, Outlet } from "react-router-dom";
import { useStore } from "../store/store";

function Logo() {
  const { data } = useStore();
  return (
    <>
      <img src="./favicon.svg" alt="" width={30} height={30} />
      <span>{data.settings.name}</span>
    </>
  );
}

export function PublicLayout() {
  const { data } = useStore();
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
          {data.locations.map((l) => (
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
              <a href={`tel:${data.settings.phone.replace(/[^\d+]/g, "")}`}>{data.settings.phone}</a>
              <br />
              <a href={`mailto:${data.settings.email}`}>{data.settings.email}</a>
            </p>
          </div>
        </div>
        <div className="container muted small" style={{ marginTop: "1rem" }}>
          Demo site: bookings are stored in this browser only.
        </div>
      </footer>
    </>
  );
}

export function AdminLayout() {
  const { data, persisted } = useStore();
  const now = Date.now();
  const overdue = data.bookings.filter((b) => b.status === "Active" && Date.parse(b.returnAt) < now).length;
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
          Bookings {overdue > 0 && <span className="badge badge-bad count">{overdue} overdue</span>}
        </NavLink>
        <NavLink to="/admin/fleet" className="side-link">
          Fleet
        </NavLink>
        <NavLink to="/admin/settings" className="side-link">
          Prices &amp; settings
        </NavLink>
        <NavLink to="/" className="side-link">
          ← Booking site
        </NavLink>
        <div className="side-extra muted small" style={{ marginTop: "auto", padding: "0.5rem" }}>
          Demo mode: no login, data is stored in this browser only.
        </div>
      </aside>
      <main className="admin-main">
        {!persisted && (
          <div className="notice" role="alert" style={{ marginBottom: "1rem" }}>
            Your browser blocked local storage, so changes will be lost when you close this tab.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
