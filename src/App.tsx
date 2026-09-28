import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminLayout, PublicLayout } from "./components/Layouts";
import { Book } from "./pages/Book";
import { Confirmation } from "./pages/Confirmation";
import { Home } from "./pages/Home";
import { Manage } from "./pages/Manage";
import { Search } from "./pages/Search";
import { StoreProvider } from "./store/store";

const Dashboard = lazy(() => import("./pages/admin/Dashboard").then((m) => ({ default: m.Dashboard })));
const Calendar = lazy(() => import("./pages/admin/Calendar").then((m) => ({ default: m.Calendar })));
const Bookings = lazy(() => import("./pages/admin/Bookings").then((m) => ({ default: m.Bookings })));
const BookingDetail = lazy(() => import("./pages/admin/BookingDetail").then((m) => ({ default: m.BookingDetail })));
const Fleet = lazy(() => import("./pages/admin/Fleet").then((m) => ({ default: m.Fleet })));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings").then((m) => ({ default: m.AdminSettings })));

function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body: newer browsers return a Promise from scrollTo, and an effect must not return it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const lazyPage = (el: React.ReactNode) => <Suspense fallback={<p className="muted">Loading…</p>}>{el}</Suspense>;

export function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <ScrollToTop />
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="book" element={<Book />} />
            <Route path="booking/:ref" element={<Confirmation />} />
            <Route path="manage" element={<Manage />} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={lazyPage(<Dashboard />)} />
            <Route path="calendar" element={lazyPage(<Calendar />)} />
            <Route path="bookings" element={lazyPage(<Bookings />)} />
            <Route path="bookings/:id" element={lazyPage(<BookingDetail />)} />
            <Route path="fleet" element={lazyPage(<Fleet />)} />
            <Route path="settings" element={lazyPage(<AdminSettings />)} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </StoreProvider>
  );
}
