import { corsHeaders, authenticate, json, serviceClient } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    const { submissionId } = await request.json();
    const workerUrl = Deno.env.get("QC_WORKER_URL");
    const workerSecret = Deno.env.get("QC_WORKER_SECRET");
    if (!workerUrl || !workerSecret) return json({ error: "Quality-control worker is not configured." }, 503);
    const service = serviceClient();
    const { data: submission } = await service.from("submissions").select("user_id,status").eq("id", submissionId).single();
    const { data: adminRole } = await service.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!submission || (submission.user_id !== user.id && !adminRole)) return json({ error: "Not authorized." }, 403);
    if (!["automated_qc", "awaiting_review"].includes(submission.status)) return json({ error: "Submission is not ready for quality control." }, 409);
    const { data: recordings, error } = await service.from("recordings")
      .select("id,object_path,prompt_assignment_id,language,original_transcript")
      .eq("submission_id", submissionId);
    if (error) return json({ error: error.message }, 500);

    const jobs = await Promise.all((recordings || []).map(async (recording) => {
      const { data: signed } = await service.storage.from("raw-recordings").createSignedUrl(recording.object_path, 3600);
      return { ...recording, signed_url: signed?.signedUrl };
    }));
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify({ submission_id: submissionId, recordings: jobs }),
    });
    if (!response.ok) return json({ error: "Quality-control worker rejected the job." }, 502);
    await service.from("audit_events").insert({
      actor_id: user.id, action: "quality_control.dispatched", entity_type: "submission", entity_id: submissionId,
      after_data: { recordings: jobs.length },
    });
    return json({ ok: true, jobs: jobs.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 401);
  }
});
