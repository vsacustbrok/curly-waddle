import { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { canEditJobs, pretty } from "./lib/types";
import { loadAlerts } from "./lib/alerts";
import Login from "./pages/Login";
import Board from "./pages/Board";
import Dictation from "./pages/Dictation";

// Every other screen is downloaded only when it is first opened, so the first load stays small.
const JobNew = lazy(() => import("./pages/JobNew"));
const JobFile = lazy(() => import("./pages/JobFile"));
const Clients = lazy(() => import("./pages/Clients"));
const Team = lazy(() => import("./pages/Team"));
const Shipments = lazy(() => import("./pages/Shipments"));
const Security = lazy(() => import("./pages/Security"));
const Reports = lazy(() => import("./pages/Reports"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Collections = lazy(() => import("./pages/Collections"));
const Soa = lazy(() => import("./pages/Soa"));

/** Menu link to the deadlines page, with how many are overdue or due today (refreshed at most once a minute). */
function AlertsLink() {
  const [urgent, setUrgent] = useState(0);
  const { pathname } = useLocation();
  useEffect(() => {
    let live = true;
    loadAlerts().then((rows) => { if (live) setUrgent(rows.filter((r) => r.alert.level !== "soon").length); }, () => {});
    return () => { live = false; };
  }, [pathname]);
  return (
    <NavLink to="/alerts">Alerts{urgent > 0 && <span className="nav-badge" aria-label={`${urgent} overdue or due today`}>{urgent}</span>}</NavLink>
  );
}

export default function App() {
  const { session, profile, loading, reload } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <Login />;
  if (!profile) return <div className="center muted">Loading your profile…</div>;

  if (profile.role === "pending") {
    return (
      <div className="center">
        <div className="card narrow">
          <h1>Waiting for approval</h1>
          <p>
            Your account ({profile.email}) is registered. The owner needs to assign you a role before you can
            see jobs.
          </p>
          <div className="row">
            <button onClick={reload}>Check again</button>
            <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  const role = profile.role;
  return (
    <>
      <header className="topbar">
        <span className="brand">
          <img src="/logo.webp" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <strong>VSA Customs Brokerage</strong>
        </span>
        <nav>
          <NavLink to="/" end>Status board</NavLink>
          <NavLink to="/shipments">Shipments</NavLink>
          <AlertsLink />
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          {canEditJobs(role) && <NavLink to="/jobs/new">New shipment</NavLink>}
          {(role === "owner" || role === "billing") && <NavLink to="/collections">Collections</NavLink>}
          <NavLink to="/clients">Clients</NavLink>
          {role === "owner" && <NavLink to="/team">Team</NavLink>}
          {role === "owner" && <NavLink to="/security">Security</NavLink>}
        </nav>
        <span className="who">
          {profile.full_name || profile.email} <span className="badge">{pretty(role)}</span>
          <button className="ghost small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </span>
      </header>
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/jobs/new" element={canEditJobs(role) ? <JobNew /> : <Navigate to="/" />} />
          <Route path="/jobs/:id" element={<JobFile />} />
          <Route path="/jobs/:id/soa" element={<Soa />} />
          <Route path="/collections" element={role === "owner" || role === "billing" ? <Collections /> : <Navigate to="/" />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/team" element={role === "owner" ? <Team /> : <Navigate to="/" />} />
          <Route path="/security" element={role === "owner" ? <Security /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </main>
      <Dictation />
    </>
  );
}
