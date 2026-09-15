import { corsHeaders, authenticate, json, requireAdmin, serviceClient } from "../_shared/security.ts";
const subunitFactor: Record<string, number> = { NGN: 100, GHS: 100, USD: 100, GBP: 100, EUR: 100 };
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    await requireAdmin(user.id);
    const { submissionId } = await request.json();
    if (!submissionId) return json({ error: "Submission ID is required." }, 400);
    const service = serviceClient();
    const { data: payment, error: claimError } = await service.rpc("claim_participant_payment", { p_submission_id: submissionId, p_admin_id: user.id });
    if (claimError || !payment) return json({ error: claimError?.message || "No eligible payment exists." }, 409);
    const payoutUrl = Deno.env.get("PAYMENTS_PROVIDER_PAYOUT_URL");
    const apiKey = Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if (!payoutUrl || !apiKey) {
      await service.from("payments").update({ status: "failed", failure_reason: "Payment provider is not configured", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return json({ error: "Payment provider is not configured." }, 503);
    }
    const currency = String(payment.currency).toUpperCase();
    const factor = subunitFactor[currency];
    const providerAmount = Math.round(Number(payment.amount) * factor);
    if (!factor || !Number.isSafeInteger(providerAmount) || providerAmount <= 0) {
      await service.from("payments").update({ status: "failed", failure_reason: `Unsupported currency or amount: ${currency}`, updated_at: new Date().toISOString() }).eq("id", payment.id);
      return json({ error: "Payment currency or amount is invalid." }, 400);
    }
    const response = await fetch(payoutUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ source: "balance", recipient: payment.recipient, amount: providerAmount, currency, reference: payment.reference }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await service.from("payments").update({ status: "failed", failure_reason: result.message || "Provider rejected payment", updated_at: new Date().toISOString() }).eq("id", payment.id);
      return json({ error: result.message || "Payment failed." }, 502);
    }
    const reference = result.data?.reference || result.reference || payment.reference;
    await service.from("payments").update({ status: "processing", provider: "paystack", provider_transaction_reference: reference, failure_reason: null, updated_at: new Date().toISOString() }).eq("id", payment.id);
    await service.from("submissions").update({ status: "payment_processing", updated_at: new Date().toISOString() }).eq("id", submissionId);
    await service.from("audit_events").insert({ actor_id: user.id, action: "payment.initiated", entity_type: "payment", entity_id: payment.id, after_data: { reference, provider_status: result.data?.status || "pending" } });
    return json({ ok: true, reference, status: "processing" }, 202);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
