-- Trigger-only SECURITY DEFINER functions should not be callable through /rest/v1/rpc.
-- Triggers keep firing: EXECUTE is not checked when a trigger invokes its function.
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.guard_profile() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_job_status() from public, anon, authenticated;
