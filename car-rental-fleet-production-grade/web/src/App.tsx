import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminLayout, PublicLayout } from "./components/Layouts";
import { Book } from "./pages/Book";
import { Confirmation } from "./pages/Confirmation";
import { Home } from "./pages/Home";
import { Manage } from "./pages/Manage";
import { Search } from "./pages/Search";

const Login = lazy(() => import("./pages/admin/Login").then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import("./pages/admin/Dashboard").then((m) => ({ default: m.Dashboard })));
const Calendar = lazy(() => import("./pages/admin/Calendar").then((m) => ({ default: m.Calendar })));
const Bookings = lazy(() => import("./pages/admin/Bookings").then((m) => ({ default: m.Bookings })));
const BookingDetail = lazy(() => import("./pages/admin/BookingDetail").then((m) => ({ default: m.BookingDetail })));
const Fleet = lazy(() => import("./pages/admin/Fleet").then((m) => ({ default: m.Fleet })));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings").then((m) => ({ default: m.AdminSettings })));
const Account = lazy(() => import("./pages/admin/Account").then((m) => ({ default: m.Account })));
const AuditLog = lazy(() => import("./pages/admin/AuditLog").then((m) => ({ default: m.AuditLog })));

function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body: newer browsers return a Promise from scrollTo, and an effect must not return it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="book" element={<Book />} />
            <Route path="booking/:ref" element={<Confirmation />} />
            <Route path="manage" element={<Manage />} />
          </Route>
          <Route path="admin/login" element={<Login />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="bookings/:id" element={<BookingDetail />} />
            <Route path="fleet" element={<Fleet />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="account" element={<Account />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
