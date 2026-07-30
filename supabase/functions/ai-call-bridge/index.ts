// deno-lint-ignore-file no-explicit-any
// Media bridge: Twilio Media Streams <-> OpenAI Realtime.
//
// Twilio opens a WebSocket to this function for the life of the call and sends
// base64 G.711 μ-law at 8kHz. OpenAI Realtime speaks the same codec natively
// (`g711_ulaw`), so audio passes through untranscoded in both directions —
// that codec match is what keeps latency low enough to feel conversational.
//
// The AI's opening turn is the compliance disclosure. It is spoken before the
// model is allowed to improvise, because under the FCC's Feb 2024 ruling an
// AI voice is an "artificial voice" under the TCPA and several states require
// it to identify itself as non-human up front.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") ?? "gpt-realtime";

const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// OpenAI Realtime audio pricing (USD/min) as of 2026-07. Update alongside
// vendor pricing; the cost ledger is only as honest as these numbers.
const AUDIO_IN_USD_PER_MIN = 0.06;
const AUDIO_OUT_USD_PER_MIN = 0.24;

interface SessionRow {
  id: string;
  team_id: string;
  disclosure_text: string | null;
  agent_id: string | null;
}

Deno.serve(async (req) => {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  // Twilio cannot send auth headers on the stream, so the session id travels in
  // the URL. It is an unguessable uuid and is validated against the DB below;
  // an unknown id gets the socket closed immediately.
  const sessionId = new URL(req.url).searchParams.get("session");
  if (!sessionId) return new Response("Missing session", { status: 400 });

  const { data: session } = await SUPABASE
    .from("ai_call_sessions")
    .select("id, team_id, disclosure_text, agent_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return new Response("Unknown session", { status: 404 });

  const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);
  bridge(twilioWs, session as SessionRow).catch((e) => {
    console.error("bridge failed", sessionId, e);
    try { twilioWs.close(); } catch { /* already closed */ }
  });
  return response;
});

async function bridge(twilioWs: WebSocket, session: SessionRow) {
  // Agent persona. The disclosure is NOT part of this prompt — it is sent as a
  // fixed first turn so the model cannot paraphrase it away.
  let instructions = "You are a professional sales development representative. Be concise, listen more than you talk, and never claim to be human.";
  if (session.agent_id) {
    const { data: agent } = await SUPABASE
      .from("voice_agents").select("system_prompt, script").eq("id", session.agent_id).maybeSingle();
    if (agent?.system_prompt) instructions = agent.system_prompt;
    if (agent?.script) instructions += `\n\nSuggested script:\n${agent.script}`;

    const { data: knowledge } = await SUPABASE
      .from("agent_knowledge").select("title, content").eq("agent_id", session.agent_id).limit(20);
    if (knowledge?.length) {
      instructions += "\n\nReference material:\n" +
        knowledge.map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n").slice(0, 12000);
    }
  }
  instructions += "\n\nIf the person asks whether you are a real person, say plainly that you are an AI assistant. If they ask to be removed from the list or say stop calling, acknowledge, confirm they will not be called again, and end the call politely.";

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
    // Deno's WebSocket cannot set headers, so Realtime's subprotocol auth is used.
    ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`, "openai-beta.realtime-v1"],
  );

  let streamSid: string | null = null;
  let audioInMs = 0;
  let audioOutMs = 0;
  const startedAt = Date.now();
  const transcript: Array<{ role: string; text: string; at: string }> = [];
  let closed = false;

  const finish = async (outcome: string) => {
    if (closed) return;
    closed = true;
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    const costUsd =
      (audioInMs / 60000) * AUDIO_IN_USD_PER_MIN +
      (audioOutMs / 60000) * AUDIO_OUT_USD_PER_MIN;
    try {
      await SUPABASE.from("ai_call_sessions").update({
        status: outcome === "completed" ? "completed" : "failed",
        outcome,
        transcript,
        duration_seconds: durationSeconds,
        cost_usd: Number(costUsd.toFixed(6)),
        ended_at: new Date().toISOString(),
      }).eq("id", session.id);

      await SUPABASE.from("api_cost_events").insert({
        team_id: session.team_id,
        search_id: null,
        provider: "openai",
        operation: "realtime_voice_minutes",
        units: Math.max(1, Math.round(durationSeconds / 60)),
        unit_cost_usd: AUDIO_IN_USD_PER_MIN + AUDIO_OUT_USD_PER_MIN,
        cost_usd: Number(costUsd.toFixed(6)),
        ok: outcome === "completed",
      });
    } catch (e) {
      console.error("finish bookkeeping failed", e);
    }
    try { openaiWs.close(); } catch { /* noop */ }
    try { twilioWs.close(); } catch { /* noop */ }
  };

  openaiWs.onopen = () => {
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        // Matching Twilio's codec on both legs avoids resampling entirely.
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
          },
          output: { format: { type: "audio/pcmu" }, voice: "alloy" },
        },
        instructions,
      },
    }));

    // Fixed disclosure turn. Sent as an assistant message the model must speak
    // verbatim, so compliance wording never drifts.
    const disclosure = session.disclosure_text?.trim();
    if (disclosure) {
      openaiWs.send(JSON.stringify({
        type: "response.create",
        response: {
          instructions: `Say exactly this and nothing else, then wait for a reply: "${disclosure}"`,
        },
      }));
      SUPABASE.from("ai_call_sessions")
        .update({ disclosure_spoken_at: new Date().toISOString() })
        .eq("id", session.id)
        .then(() => {}, (e: any) => console.error("disclosure stamp failed", e));
    }
  };

  openaiWs.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.type) {
      case "response.output_audio.delta": {
        if (!streamSid || !msg.delta) break;
        audioOutMs += estimateUlawMs(msg.delta);
        twilioWs.send(JSON.stringify({
          event: "media", streamSid, media: { payload: msg.delta },
        }));
        break;
      }
      case "response.output_audio_transcript.done":
        if (msg.transcript) transcript.push({ role: "assistant", text: msg.transcript, at: new Date().toISOString() });
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) transcript.push({ role: "prospect", text: msg.transcript, at: new Date().toISOString() });
        break;
      case "input_audio_buffer.speech_started":
        // Barge-in: the prospect started talking, so drop audio already queued
        // at Twilio. Without this the AI talks over an interruption.
        if (streamSid) twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
        break;
      case "error":
        console.error("openai realtime error", msg.error);
        break;
    }
  };

  openaiWs.onerror = (e) => { console.error("openai ws error", e); finish("openai_error"); };
  openaiWs.onclose = () => { finish("completed"); };

  twilioWs.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.event) {
      case "start":
        streamSid = msg.start?.streamSid ?? null;
        SUPABASE.from("ai_call_sessions")
          .update({ status: "in_progress" })
          .eq("id", session.id)
          .then(() => {}, (e: any) => console.error("status update failed", e));
        break;
      case "media":
        if (openaiWs.readyState === WebSocket.OPEN && msg.media?.payload) {
          audioInMs += estimateUlawMs(msg.media.payload);
          openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
        }
        break;
      case "stop":
        finish("completed");
        break;
    }
  };

  twilioWs.onerror = (e) => { console.error("twilio ws error", e); finish("twilio_error"); };
  twilioWs.onclose = () => { finish("completed"); };
}

/** μ-law 8kHz is 1 byte per sample, so 8 bytes = 1ms. Base64 is 4:3. */
function estimateUlawMs(base64: string): number {
  return Math.round((base64.length * 3 / 4) / 8);
}
