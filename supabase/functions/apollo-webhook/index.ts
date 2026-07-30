// deno-lint-ignore-file no-explicit-any
// Apollo waterfall enrichment callback.
// Apollo POSTs here when an async people/match (run_waterfall_*) completes.
// Public function — verifies the token query param against
// team_settings.inbox_sms_webhook_secret (we reuse the per-team secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const teamId = url.searchParams.get("team_id");
  const contactId = url.searchParams.get("contact_id");
  if (!token || !teamId || !contactId) {
    return new Response("missing params", { status: 400, headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: settings } = await db.from("team_settings").select("inbox_sms_webhook_secret").eq("team_id", teamId).maybeSingle();
  if (!settings || settings.inbox_sms_webhook_secret !== token) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* ignore */ }
  const person = payload.person ?? payload.contact ?? payload;
  const emails: string[] = [
    person.email,
    ...(person.personal_emails ?? []),
  ].filter(Boolean);
  const phones: string[] = (person.phone_numbers ?? [])
    .map((p: any) => p.sanitized_number ?? p.raw_number)
    .filter(Boolean);

  for (const email of emails) {
    await db.from("contact_emails").insert({
      team_id: teamId, contact_id: contactId,
      email, sources: ["apollo_waterfall"], source_type: "direct",
    });
  }
  for (const phone of phones) {
    await db.from("contact_phones").insert({
      team_id: teamId, contact_id: contactId,
      phone_number: phone, sources: ["apollo_waterfall"],
      confidence_score: 70,
    });
  }

  return new Response(JSON.stringify({ ok: true, emails: emails.length, phones: phones.length }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
