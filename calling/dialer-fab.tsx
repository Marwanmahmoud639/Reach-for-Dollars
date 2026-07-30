import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Phone, PhoneOff, Delete, Mic, MicOff, PhoneCall, History as HistoryIcon,
  MessageSquare, X, Plus, Send, ArrowLeft, ChevronRight,
} from "lucide-react";
import { useCalling } from "./calling-provider";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { listThreads, getThread, startThread, sendSms } from "@/lib/sms.functions";
import { toast } from "sonner";

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

type Tab = "call" | "sms" | "history";
type Recent = {
  id: string;
  phone_number: string;
  direction: string;
  duration_seconds: number | null;
  call_status: string | null;
  created_at: string;
  contact: { id: string; name: string } | null;
};
type Thread = {
  id: string; phone_number: string; last_message_at: string;
  last_preview: string | null; unread_count: number;
  contact: { id: string; name: string } | null;
};
type SmsMsg = {
  id: string; direction: "inbound" | "outbound"; body: string;
  status: string | null; from_number: string; to_number: string; sent_at: string;
};

function fmtDur(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}
function statusLabel(status: string, inCall: boolean, durationSec: number) {
  if (status === "uninitialized") return "Tap dial to connect";
  if (status === "loading") return "Connecting…";
  if (status === "ready") return "Ready";
  if (inCall) return durationSec === 0 ? "Ringing…" : `Connected · ${fmtDur(durationSec)}`;
  if (status === "error") return "Error";
  return "";
}

export function DialerFab() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("call");
  const { status } = useCalling();
  const inCall = status === "in_call";

  return (
    <>
      <button
        aria-label="Open dialer"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed z-40 bottom-20 right-4 md:bottom-6 md:right-6 w-12 h-12 md:w-14 md:h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition",
          inCall && "animate-pulse",
        )}
      >
        {inCall ? <PhoneCall className="w-5 h-5 md:w-6 md:h-6" /> : <Phone className="w-5 h-5 md:w-6 md:h-6" />}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="w-full sm:max-w-sm sm:inset-y-0 sm:right-0 sm:h-full sm:border-l sm:border-t-0 flex flex-col p-0 rounded-t-2xl sm:rounded-none max-h-[92vh] sm:max-h-none bg-card"
        >
          <DialerHeader tab={tab} setTab={setTab} onClose={() => setOpen(false)} />
          <div className="flex-1 overflow-hidden flex flex-col">
            {tab === "call" && <CallTab />}
            {tab === "sms" && <SmsTab open={open} />}
            {tab === "history" && <HistoryTab open={open} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DialerHeader({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const Btn = ({ k, icon: Icon, label }: { k: Tab; icon: any; label: string }) => (
    <button
      onClick={() => setTab(k)}
      aria-label={label}
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center transition",
        tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Phone className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">Dialer</span>
      </div>
      <div className="flex items-center gap-1">
        <Btn k="call" icon={Phone} label="Call" />
        <Btn k="sms" icon={MessageSquare} label="Messages" />
        <Btn k="history" icon={HistoryIcon} label="History" />
        <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground flex items-center justify-center ml-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ─────────── Call Tab ─────────── */
function CallTab() {
  const [number, setNumber] = useState("");
  const [recents, setRecents] = useState<Recent[]>([]);
  const { team } = useAuth();
  const { status, activeNumber, durationSec, startCall, hangUp, sendDigit, toggleMute, muted, error } = useCalling();
  const inCall = status === "in_call";

  useEffect(() => {
    if (!team?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("call_history")
        .select("id, phone_number, direction, duration_seconds, call_status, created_at, contact:contacts(id,name)")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled) setRecents((data as any[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [team?.id, inCall]);

  const pressKey = (k: string) => {
    if (inCall) sendDigit(k);
    else setNumber(n => (n.length < 20 ? n + k : n));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4">
      <div className="text-center mb-2">
        <div className={cn("text-[10px] uppercase tracking-wider",
          status === "error" ? "text-destructive" : inCall ? "text-emerald-500" : "text-muted-foreground")}>
          {status === "error" ? `Error: ${error}` : inCall ? statusLabel(status, inCall, durationSec) : "Enter number"}
        </div>
        <div className="text-2xl font-mono mt-1 min-h-[32px] tabular-nums">{inCall ? activeNumber : (number || "—")}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 my-2 mx-auto w-full max-w-[280px]">
        {KEYS.map(([k, sub]) => (
          <button
            key={k}
            onClick={() => pressKey(k)}
            className="aspect-square rounded-2xl bg-muted hover:bg-accent active:scale-95 transition flex flex-col items-center justify-center"
          >
            <span className="text-xl font-semibold leading-none">{k}</span>
            {sub && <span className="text-[9px] text-muted-foreground tracking-widest mt-0.5">{sub}</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 pb-1">
        {!inCall ? (
          <>
            <div className="w-10" />
            <Button
              className="rounded-full w-12 h-12 bg-success hover:bg-success/90"
              disabled={!number || status === "loading"}
              onClick={() => startCall(number)}
            >
              <Phone className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setNumber(n => n.slice(0, -1))} disabled={!number}>
              <Delete className="w-5 h-5" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <MicOff className="w-5 h-5 text-destructive" /> : <Mic className="w-5 h-5" />}
            </Button>
            <Button variant="destructive" className="rounded-full w-12 h-12" onClick={hangUp}>
              <PhoneOff className="w-5 h-5" />
            </Button>
            <div className="w-10" />
          </>
        )}
      </div>
      {recents.length > 0 && (
        <div className="mt-3 flex-1 overflow-y-auto border-t border-border pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent</div>
          <div className="space-y-1">
            {recents.map(r => (
              <button
                key={r.id}
                onClick={() => setNumber(r.phone_number)}
                disabled={inCall}
                className="w-full text-left p-2 rounded-md hover:bg-accent transition flex items-center justify-between gap-2 disabled:opacity-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.contact?.name || r.phone_number}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.call_status || r.direction}{r.duration_seconds ? ` · ${fmtDur(r.duration_seconds)}` : ""}
                  </div>
                </div>
                <Phone className="w-4 h-4 text-primary shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── SMS Tab ─────────── */
function SmsTab({ open }: { open: boolean }) {
  const list = useServerFn(listThreads);
  const start = useServerFn(startThread);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [newTo, setNewTo] = useState("");
  const { team } = useAuth();

  const refresh = async () => {
    try { const r = await list({}); setThreads(r.threads as any); }
    catch (e: any) { /* noop */ }
  };
  useEffect(() => { if (open) refresh(); }, [open]);

  // Realtime updates for new messages
  useEffect(() => {
    if (!team?.id) return;
    const ch = supabase
      .channel("sms-threads-" + team.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_threads", filter: `team_id=eq.${team.id}` }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [team?.id]);

  const handleStart = async () => {
    if (!newTo.trim()) return;
    try {
      const r = await start({ data: { to: newTo.trim() } });
      setActiveId(r.threadId);
      setComposing(false); setNewTo("");
      refresh();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
  };

  if (activeId) {
    return <ThreadView threadId={activeId} onBack={() => { setActiveId(null); refresh(); }} />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 flex items-center justify-between border-b border-border">
        <div className="text-sm font-medium">Messages</div>
        <Button size="sm" variant="ghost" onClick={() => setComposing(v => !v)}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {composing && (
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Input
            value={newTo}
            onChange={e => setNewTo(e.target.value)}
            placeholder="+1 555 555 5555"
            className="rounded-full border-primary/40 focus-visible:ring-primary"
          />
          <Button onClick={handleStart} disabled={!newTo.trim()} className="rounded-full bg-primary text-primary-foreground hover:opacity-90">Start</Button>
          <Button size="icon" variant="ghost" onClick={() => { setComposing(false); setNewTo(""); }}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">No conversations yet</div>
        ) : (
          threads.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className="w-full text-left px-4 py-3 hover:bg-accent transition flex items-center gap-3 border-b border-border/60"
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate">{t.contact?.name || t.phone_number}</div>
                  <div className="text-[10px] text-muted-foreground shrink-0">{new Date(t.last_message_at).toLocaleDateString()}</div>
                </div>
                <div className="text-xs text-muted-foreground truncate">{t.last_preview || "—"}</div>
              </div>
              {t.unread_count > 0 && <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">{t.unread_count}</span>}
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const get = useServerFn(getThread);
  const send = useServerFn(sendSms);
  const [thread, setThread] = useState<any>(null);
  const [msgs, setMsgs] = useState<SmsMsg[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const r = await get({ data: { id: threadId } });
      setThread(r.thread); setMsgs(r.messages as any);
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
  };
  useEffect(() => { refresh(); }, [threadId]);

  useEffect(() => {
    const ch = supabase
      .channel("sms-msgs-" + threadId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sms_messages", filter: `thread_id=eq.${threadId}` }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs.length]);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await send({ data: { threadId, body: body.trim() } });
      setBody("");
      refresh();
    } catch (e: any) { toast.error(e.message ?? "Failed to send"); }
    finally { setSending(false); }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
        <Button size="icon" variant="ghost" onClick={onBack}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{thread?.contact?.name || thread?.phone_number || "…"}</div>
          {thread?.contact && <div className="text-[10px] text-muted-foreground truncate">{thread.phone_number}</div>}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {msgs.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">No messages yet</div>}
        {msgs.map(m => (
          <div key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[75%] rounded-2xl px-3 py-1.5 text-sm",
              m.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted",
            )}>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className={cn("text-[9px] mt-0.5 opacity-70", m.direction === "outbound" ? "text-primary-foreground" : "text-muted-foreground")}>
                {new Date(m.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2 flex items-center gap-2">
        <Input
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Type a message…"
          className="rounded-full"
        />
        <Button size="icon" disabled={!body.trim() || sending} onClick={handleSend} className="rounded-full bg-primary text-primary-foreground">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

/* ─────────── History Tab ─────────── */
type HistFilter = "all" | "calls" | "sms";
function HistoryTab({ open }: { open: boolean }) {
  const [filter, setFilter] = useState<HistFilter>("all");
  const { team } = useAuth();
  const [calls, setCalls] = useState<Recent[]>([]);
  const [smsRows, setSmsRows] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !team?.id) return;
    let cancelled = false;
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from("call_history")
          .select("id, phone_number, direction, duration_seconds, call_status, created_at, contact:contacts(id,name)")
          .eq("team_id", team.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("sms_messages")
          .select("id, body, direction, sent_at, from_number, to_number")
          .eq("team_id", team.id).order("sent_at", { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      setCalls((c.data as any[]) ?? []);
      setSmsRows((s.data as any[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [open, team?.id]);

  const items = useMemo(() => {
    const callItems = calls.map(c => ({
      kind: "call" as const, id: c.id, when: c.created_at, label: c.contact?.name || c.phone_number,
      sub: `${c.call_status || c.direction}${c.duration_seconds ? ` · ${fmtDur(c.duration_seconds)}` : ""}`,
    }));
    const smsItems = smsRows.map(s => ({
      kind: "sms" as const, id: s.id, when: s.sent_at,
      label: s.direction === "outbound" ? s.to_number : s.from_number,
      sub: s.body.slice(0, 80),
    }));
    let combined = [...callItems, ...smsItems];
    if (filter === "calls") combined = callItems;
    if (filter === "sms") combined = smsItems;
    combined.sort((a, b) => +new Date(b.when) - +new Date(a.when));
    return combined;
  }, [calls, smsRows, filter]);

  const Chip = ({ k, label }: { k: HistFilter; label: string }) => (
    <button
      onClick={() => setFilter(k)}
      className={cn(
        "px-4 py-1.5 rounded-full text-xs font-medium transition",
        filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
      )}
    >{label}</button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Chip k="all" label="All" />
        <Chip k="calls" label="Calls" />
        <Chip k="sms" label="SMS" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12">No recent activity</div>
        ) : items.map(it => (
          <div key={it.kind + it.id} className="px-4 py-2.5 border-b border-border/60 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              {it.kind === "call" ? <Phone className="w-4 h-4 text-muted-foreground" /> : <MessageSquare className="w-4 h-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{it.label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{it.sub}</div>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">{new Date(it.when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
