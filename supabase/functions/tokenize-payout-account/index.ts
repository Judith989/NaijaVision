import { corsHeaders, authenticate, json, serviceClient } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    const input = await request.json();
    const accountNumber = String(input.accountNumber || "").replace(/\D/g, "");
    const bankCode = String(input.bankCode || "").trim();
    if (accountNumber.length !== 10 || !input.bankName || !bankCode || input.country !== "Nigeria") {
      return json({ error: "Select a Nigerian bank and enter a valid 10-digit account number." }, 400);
    }

    const apiKey = Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if (!apiKey) return json({ error: "Bank verification provider is not configured." }, 503);

    const resolveResponse = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const resolveData = await resolveResponse.json();
    const resolvedName = resolveData.data?.account_name;
    if (!resolveResponse.ok || !resolvedName) return json({ error: "The account number could not be matched to the selected bank." }, 422);

    const providerResponse = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        type: "nuban",
        name: resolvedName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
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
      bank_code: bankCode,
      bank_name: input.bankName,
      account_name: resolvedName,
      account_last4: accountNumber.slice(-4),
      provider: Deno.env.get("PAYMENTS_PROVIDER_NAME") || "paystack",
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
    return json({ ok: true, accountName: resolvedName, accountLast4: accountNumber.slice(-4) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 401);
  }
});
