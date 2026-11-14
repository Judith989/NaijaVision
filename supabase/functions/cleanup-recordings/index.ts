import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanupRecordings } from './cleanup.mjs';

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('NOTIFICATION_WORKER_SECRET');
  if (!secret || request.headers.get('x-notification-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
  });
  try {
    return Response.json(await cleanupRecordings(service));
  } catch {
    return Response.json({ error: 'Cleanup could not complete; unconfirmed jobs will be retried.' }, { status: 500 });
  }
});
