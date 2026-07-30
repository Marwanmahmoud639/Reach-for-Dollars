import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getVoiceAccessToken, logCall } from "@/lib/calling.functions";
import { toast } from "sonner";

type Status = "uninitialized" | "loading" | "ready" | "in_call" | "error";

interface CallingState {
  status: Status;
  error: string | null;
  activeNumber: string | null;
  activeContactId: string | null;
  startCall: (number: string, contactId?: string | null) => Promise<void>;
  hangUp: () => void;
  sendDigit: (d: string) => void;
  toggleMute: () => void;
  muted: boolean;
  durationSec: number;
}

const Ctx = createContext<CallingState | null>(null);

declare global {
  interface Window {
    Twilio?: {
      Device?: new (token: string, options?: Record<string, unknown>) => any;
    };
  }
}

const TWILIO_VOICE_SDK_SRC = "/vendor/twilio-voice-sdk.min.js";
let twilioVoiceSdkPromise: Promise<new (token: string, options?: Record<string, unknown>) => any> | null = null;

function loadTwilioDevice() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Calling is only available in the browser"));
  }
  if (window.Twilio?.Device) return Promise.resolve(window.Twilio.Device);
  if (twilioVoiceSdkPromise) return twilioVoiceSdkPromise;

  twilioVoiceSdkPromise = new Promise((resolve, reject) => {
    const resolveDevice = () => {
      const Device = window.Twilio?.Device;
      if (Device) resolve(Device);
      else reject(new Error("Twilio Voice SDK failed to initialize"));
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TWILIO_VOICE_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", resolveDevice, { once: true });
      existing.addEventListener("error", () => reject(new Error("Twilio Voice SDK failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TWILIO_VOICE_SDK_SRC;
    script.async = true;
    script.onload = resolveDevice;
    script.onerror = () => reject(new Error("Twilio Voice SDK failed to load"));
    document.head.appendChild(script);
  });

  return twilioVoiceSdkPromise;
}

export function useCalling() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCalling must be inside CallingProvider");
  return c;
}

export function CallingProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("uninitialized");
  const [error, setError] = useState<string | null>(null);
  const [activeNumber, setActiveNumber] = useState<string | null>(null);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);

  const deviceRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getToken = useServerFn(getVoiceAccessToken);
  const logCallFn = useServerFn(logCall);

  const ensureDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current;
    setStatus("loading");
    const res = await getToken();
    if (!res.token) {
      setStatus("error"); setError(res.error || "Token error");
      throw new Error(res.error || "Token error");
    }
    const Device = await loadTwilioDevice();
    const device = new Device(res.token, { logLevel: 1 });
    device.on("registered", () => setStatus("ready"));
    device.on("error", (e: any) => { setStatus("error"); setError(e?.message || String(e)); });
    await device.register();
    deviceRef.current = device;
    setStatus("ready");
    return device;
  }, [getToken]);

  const stopTimer = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };

  const cleanupCall = useCallback(async (status: string) => {
    const startedAt = startedAtRef.current;
    const number = activeNumber;
    const contactId = activeContactId;
    stopTimer();
    callRef.current = null;
    startedAtRef.current = null;
    setStatus(deviceRef.current ? "ready" : "uninitialized");
    setActiveNumber(null);
    setActiveContactId(null);
    setMuted(false);
    const dur = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
    setDurationSec(0);
    if (number) {
      try {
        await logCallFn({ data: { phone_number: number, direction: "outbound", duration_seconds: dur, call_status: status, contact_id: contactId ?? null } });
      } catch {/* swallow */}
    }
  }, [activeNumber, activeContactId, logCallFn]);

  const startCall = useCallback(async (number: string, contactId?: string | null) => {
    try {
      const device = await ensureDevice();
      const call = await device.connect({ params: { To: number } });
      callRef.current = call;
      setActiveNumber(number);
      setActiveContactId(contactId ?? null);
      setStatus("in_call");
      setDurationSec(0);
      call.on("accept", () => {
        startedAtRef.current = Date.now();
        tickRef.current = setInterval(() => {
          if (startedAtRef.current) setDurationSec(Math.round((Date.now() - startedAtRef.current) / 1000));
        }, 1000);
      });
      call.on("disconnect", () => cleanupCall("completed"));
      call.on("cancel", () => cleanupCall("canceled"));
      call.on("reject", () => cleanupCall("rejected"));
      call.on("error", () => cleanupCall("failed"));
    } catch (e: any) {
      toast.error(e?.message || "Call failed");
      setStatus("error");
    }
  }, [cleanupCall, ensureDevice]);

  const hangUp = useCallback(() => {
    try { callRef.current?.disconnect(); } catch {/* ignore */}
  }, []);

  const sendDigit = useCallback((d: string) => {
    try { callRef.current?.sendDigits(d); } catch {/* ignore */}
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    try { callRef.current?.mute(next); setMuted(next); } catch {/* ignore */}
  }, [muted]);

  useEffect(() => () => {
    stopTimer();
    try { deviceRef.current?.destroy(); } catch {/* ignore */}
  }, []);

  return (
    <Ctx.Provider value={{ status, error, activeNumber, activeContactId, startCall, hangUp, sendDigit, toggleMute, muted, durationSec }}>
      {children}
    </Ctx.Provider>
  );
}
