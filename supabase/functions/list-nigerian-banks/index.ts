import { corsHeaders, authenticate, json } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await authenticate(request);
    const apiKey = Deno.env.get("PAYMENTS_PROVIDER_API_KEY");
    if (!apiKey) return json({ error: "Bank verification provider is not configured." }, 503);
    const response = await fetch("https://api.paystack.co/bank?country=nigeria&currency=NGN&perPage=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.data)) return json({ error: "The Nigerian bank list is temporarily unavailable." }, 502);
    const banks = payload.data
      .filter((bank: Record<string, unknown>) => bank.active !== false && typeof bank.name === "string" && typeof bank.code === "string")
      .map((bank: Record<string, unknown>) => ({ name: bank.name, code: bank.code }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    return json({ banks });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 401);
  }
});
