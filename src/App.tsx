import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { supabase } from "./lib/supabase";
import { canEditJobs, pretty } from "./lib/types";
import Login from "./pages/Login";
import Board from "./pages/Board";
import JobNew from "./pages/JobNew";
import JobFile from "./pages/JobFile";
import Clients from "./pages/Clients";
import Team from "./pages/Team";
import Shipments from "./pages/Shipments";

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
          <img src="https://xskvjxbvkgysvwlotjpf.supabase.co/storage/v1/object/public/site-assets/vsacb-logo" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <strong>VSA Customs Brokerage</strong>
        </span>
        <nav>
          <NavLink to="/" end>Status board</NavLink>
          <NavLink to="/shipments">Shipments</NavLink>
          {canEditJobs(role) && <NavLink to="/jobs/new">New shipment</NavLink>}
          <NavLink to="/clients">Clients</NavLink>
          {role === "owner" && <NavLink to="/team">Team</NavLink>}
        </nav>
        <span className="who">
          {profile.full_name || profile.email} <span className="badge">{pretty(role)}</span>
          <button className="ghost small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/jobs/new" element={canEditJobs(role) ? <JobNew /> : <Navigate to="/" />} />
          <Route path="/jobs/:id" element={<JobFile />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/team" element={role === "owner" ? <Team /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
