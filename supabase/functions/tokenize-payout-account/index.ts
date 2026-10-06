import { corsHeaders, authenticate, json, requireActiveAccount, serviceClient } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await authenticate(request);
    await requireActiveAccount(user.id);
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
    if (!resolveResponse.ok || !resolvedName) {
      const providerMessage = typeof resolveData?.message === "string" ? resolveData.message : "";
      return json({
        error: providerMessage || "The account number could not be matched to the selected bank. Check the bank and account number, then try again.",
      }, 422);
    }

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
    const providerData = await providerResponse.json();
    if (!providerResponse.ok) {
      const providerMessage = typeof providerData?.message === "string" ? providerData.message : "";
      return json({
        error: providerMessage || "The verified bank account could not be prepared for payment. Please try again or contact NaijaVision support.",
      }, 422);
    }
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
    // Keep the full number in the separately protected admin-only table. Supabase
    // clients cannot read this table directly; only the authorization-checking
    // account-directory RPC can return it to an administrator. This also lets
    // finance staff complete a manual transfer when the provider token cannot
    // be used, without exposing the number on participant or reviewer screens.
    const { error: protectedDetailsError } = await service.from("manual_payout_details").upsert({
      user_id: user.id,
      country: input.country,
      bank_code: bankCode,
      bank_name: input.bankName,
      account_name: resolvedName,
      account_number: accountNumber,
      status: "verified",
      rejection_reason: null,
      submitted_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      reviewed_by: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (protectedDetailsError) return json({ error: protectedDetailsError.message }, 500);
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
