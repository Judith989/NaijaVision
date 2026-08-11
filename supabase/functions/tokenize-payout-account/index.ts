import { corsHeaders, authenticate, json, serviceClient } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    const input = await request.json();
    const accountNumber = String(input.accountNumber || "").replace(/\D/g, "");
    if (accountNumber.length < 6 || !input.bankName || !input.accountName || !input.country) {
      return json({ error: "Complete bank details are required." }, 400);
    }

    const tokenizationUrl = Deno.env.get("PAYMENTS_PROVIDER_TOKENIZE_URL");
    const apiKey = Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if (!tokenizationUrl || !apiKey) return json({ error: "Payment provider is not configured." }, 503);

    const providerResponse = await fetch(tokenizationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        country: input.country,
        bank_name: input.bankName,
        bank_code: input.bankCode || input.bankName,
        account_name: input.accountName,
        account_number: accountNumber,
      }),
    });
    if (!providerResponse.ok) return json({ error: "The bank account could not be verified." }, 422);
    const providerData = await providerResponse.json();
    const recipientCode = providerData.recipient_code || providerData.data?.recipient_code || providerData.token;
    if (!recipientCode) return json({ error: "The payment provider returned no recipient token." }, 502);

    const service = serviceClient();
    const { error } = await service.from("payout_accounts").upsert({
      user_id: user.id,
      country: input.country,
      bank_code: input.bankCode || input.bankName,
      bank_name: input.bankName,
      account_name: providerData.account_name || providerData.data?.account_name || input.accountName,
      account_last4: accountNumber.slice(-4),
      provider: Deno.env.get("PAYMENTS_PROVIDER_NAME") || "configured-provider",
      provider_recipient_code: recipientCode,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return json({ error: error.message }, 500);
    const { data: sharedAccounts } = await service.from("payout_accounts")
      .select("user_id")
      .eq("provider_recipient_code", recipientCode)
      .neq("user_id", user.id);
    if (sharedAccounts?.length) {
      await service.from("risk_flags").insert({
        user_id: user.id,
        flag_type: "shared_payout_destination",
        score: 0.7,
        evidence: { matching_accounts: sharedAccounts.length },
      });
    }
    return json({ ok: true, accountLast4: accountNumber.slice(-4) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 401);
  }
});
