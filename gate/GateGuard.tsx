import { useEffect, useRef, useState } from "react";
import {
  AGENCY_GATE_PASSWORD, GATE_SESSION_KEY, GATE_LOCKOUT_KEY,
  GATE_FAILS_KEY, GATE_MAX_FAILS, GATE_LOCKOUT_SECONDS,
} from "@/lib/gate-config";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

function readNum(key: string): number {
  if (typeof window === "undefined") return 0;
  const v = sessionStorage.getItem(key);
  return v ? parseInt(v, 10) || 0 : 0;
}

export function GateGuard({ children }: { children: React.ReactNode }) {
  const [passed, setPassed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && sessionStorage.getItem(GATE_SESSION_KEY) === "true") {
      setPassed(true);
    }
  }, []);

  // SSR: render nothing dynamic — the gate flashes on first client render.
  if (!mounted) return null;
  if (passed) return <>{children}</>;
  return <MasterGate onPass={() => setPassed(true)} />;
}

function MasterGate({ onPass }: { onPass: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [lockUntil, setLockUntil] = useState<number>(() => readNum(GATE_LOCKOUT_KEY));
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const locked = lockUntil > now;
  const secondsLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    if (value === AGENCY_GATE_PASSWORD) {
      sessionStorage.setItem(GATE_SESSION_KEY, "true");
      sessionStorage.removeItem(GATE_FAILS_KEY);
      sessionStorage.removeItem(GATE_LOCKOUT_KEY);
      onPass();
      return;
    }
    const fails = readNum(GATE_FAILS_KEY) + 1;
    sessionStorage.setItem(GATE_FAILS_KEY, String(fails));
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setValue("");
    if (fails >= GATE_MAX_FAILS) {
      const until = Date.now() + GATE_LOCKOUT_SECONDS * 1000;
      sessionStorage.setItem(GATE_LOCKOUT_KEY, String(until));
      sessionStorage.setItem(GATE_FAILS_KEY, "0");
      setLockUntil(until);
      setError(`Too many attempts. Locked for ${GATE_LOCKOUT_SECONDS}s.`);
    } else {
      setError(`Incorrect. Try again. (${GATE_MAX_FAILS - fails} left)`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: "#000000" }}
    >

      <style>{`
        @keyframes dfd-shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .dfd-shake { animation: dfd-shake 0.45s ease; }
      `}</style>
      <div className="w-full max-w-sm text-center">
        <div className="mb-2 text-[11px] tracking-[0.3em] text-muted-foreground font-mono">{BRAND.eyebrow}</div>
        <div className="text-4xl font-bold tracking-tight text-white" style={{ fontFamily: "Sora" }}>
          {BRAND.long}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">Internal</div>

        <form onSubmit={submit} className={cn("mt-10", shake && "dfd-shake")}>
          <input
            ref={inputRef}
            type="password"
            disabled={locked}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            placeholder={locked ? `Locked — ${secondsLeft}s` : "Enter access code"}
            className={cn(
              "w-full h-14 px-5 rounded-xl text-center text-base text-white bg-white/[0.04] outline-none transition-colors",
              "border-2",
              error ? "border-red-500/80" : "border-white/10 focus:border-primary",
              locked && "opacity-60 cursor-not-allowed",
            )}
            autoComplete="off"
            aria-label="Access code"
          />
          {error && (
            <div className="mt-3 text-sm text-red-400">{error}</div>
          )}
          <button
            type="submit"
            disabled={locked || value.length === 0}
            className={cn(
              "mt-4 w-full h-12 rounded-xl font-semibold text-white transition-all",
              "bg-primary hover:opacity-90 active:scale-[0.99]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {locked ? `Try again in ${secondsLeft}s` : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
