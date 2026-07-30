import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed } from "lucide-react";

type Call = {
  id: string; phone_number: string; direction: "inbound" | "outbound";
  duration_seconds: number | null; call_status: string | null; created_at: string;
  recording_url: string | null; transcription: string | null;
};

function fmtDur(s: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export function CallHistoryList({ contactId }: { contactId: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [openTx, setOpenTx] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("call_history")
        .select("id,phone_number,direction,duration_seconds,call_status,created_at,recording_url,transcription")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(50);
      setCalls((data ?? []) as Call[]);
    })();
  }, [contactId]);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3">Call history</h3>
      {calls.length === 0 ? <p className="text-xs text-muted-foreground">No calls yet.</p> : (
        <div className="space-y-2">
          {calls.map(c => {
            const Icon = c.direction === "inbound" ? (c.call_status === "no-answer" ? PhoneMissed : PhoneIncoming) : PhoneOutgoing;
            return (
              <div key={c.id} className="border-b last:border-0 pb-2 text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${c.direction === "outbound" ? "text-primary" : "text-success"}`} />
                  <span className="font-mono">{c.phone_number}</span>
                  <Badge variant="outline" className="text-[10px]">{c.call_status || "—"}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDur(c.duration_seconds)} · {new Date(c.created_at).toLocaleString()}</span>
                </div>
                {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline ml-6">Recording</a>}
                {c.transcription && (
                  <button onClick={() => setOpenTx(openTx === c.id ? null : c.id)} className="text-xs text-muted-foreground ml-6 hover:text-foreground block">
                    {openTx === c.id ? "Hide" : "Show"} transcription
                  </button>
                )}
                {openTx === c.id && c.transcription && (
                  <p className="text-xs text-muted-foreground bg-muted rounded p-2 mt-1 ml-6 whitespace-pre-wrap">{c.transcription}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
