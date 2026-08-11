import { corsHeaders, authenticate, json, requireAdmin, serviceClient } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    await requireAdmin(user.id);
    const { submissionId } = await request.json();
    const service = serviceClient();
    const { data: payment, error } = await service
      .from("payments")
      .select("*,payout_accounts(*)")
      .eq("submission_id", submissionId)
      .eq("status", "eligible")
      .single();
    if (error || !payment) return json({ error: "No eligible payment exists." }, 404);

    await service.from("payments").update({
      status: "processing", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", payment.id);

    const payoutUrl = Deno.env.get("PAYMENTS_PROVIDER_PAYOUT_URL");
    const apiKey = Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if (!payoutUrl || !apiKey) return json({ error: "Payment provider is not configured." }, 503);
    const response = await fetch(payoutUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        recipient: payment.payout_accounts.provider_recipient_code,
        amount: payment.amount,
        currency: payment.currency,
        reference: `NV-${payment.id}`,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      await service.from("payments").update({
        status: "failed", failure_reason: result.message || "Provider rejected payment", updated_at: new Date().toISOString(),
      }).eq("id", payment.id);
      return json({ error: result.message || "Payment failed." }, 502);
    }

    const reference = result.reference || result.data?.reference || result.id;
    await service.from("payments").update({
      status: "paid", provider_transaction_reference: reference, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", payment.id);
    await service.from("submissions").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", submissionId);
    await service.from("notifications").insert({
      user_id: payment.user_id,
      type: "payment_paid",
      title: "Compensation sent",
      message: `Your ${payment.amount} ${payment.currency} compensation has been processed.`,
    });
    await service.from("audit_events").insert({
      actor_id: user.id, action: "payment.paid", entity_type: "payment", entity_id: payment.id,
      after_data: { reference },
    });
    return json({ ok: true, reference });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 401);
  }
});
