import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Client, Profile } from "../lib/types";
import JobFields, { emptyJob, toRow, type JobForm } from "./JobFields";

export default function JobNew() {
  const nav = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [form, setForm] = useState<JobForm>(emptyJob);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
    supabase.from("profiles").select("*").in("role", ["owner", "processor"]).order("full_name")
      .then(({ data }) => setStaff((data as Profile[]) ?? []));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.from("jobs").insert(toRow(form)).select("id").single();
    setBusy(false);
    if (error) setError(error.message);
    else nav(`/jobs/${data.id}`);
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>New job</h1>
      {clients.length === 0 && <p className="muted">No clients yet. <Link to="/clients">Add a client</Link> first.</p>}
      <JobFields form={form} setForm={setForm} clients={clients} staff={staff} />
      {error && <p className="error">{error}</p>}
      <div className="row"><button disabled={busy || !form.client_id}>Create job</button></div>
    </form>
  );
}
