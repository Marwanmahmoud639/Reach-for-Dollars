import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Coins, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Snapshot = {
  provider: string;
  balance: number | null;
  error: string | null;
  fetched_at: string;
};

const LABELS: Record<string, string> = {
  hunter: "Hunter.io",
  apollo: "Apollo.io",
  lusha: "Lusha",
  seamless: "Seamless.AI",
  clay: "Clay",
  firecrawl: "Firecrawl",
  serper: "Serper",
};

export function ApiCreditsPanel({ teamId }: { teamId: string | null | undefined }) {
  const [rows, setRows] = useState<Snapshot[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pull latest snapshot per provider
      const { data } = await supabase
        .from("api_credit_snapshots")
        .select("provider,balance,error,fetched_at")
        .eq("team_id", teamId)
        .order("fetched_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const latest = new Map<string, Snapshot>();
      for (const r of (data || []) as Snapshot[]) {
        if (!latest.has(r.provider)) latest.set(r.provider, r);
      }
      setRows(Array.from(latest.values()));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  return (
    <Card className="p-6 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Paid API Credit Balances</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Last known balance for each paid lookup provider, captured at the start of every discovery run.
        When a balance hits zero, that provider is skipped and free sources are used instead.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading balances…
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No snapshots yet. Run a discovery search to populate balances.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => {
            const exhausted = r.balance === 0;
            const unknown = r.balance === null;
            return (
              <div key={r.provider} className="border border-border rounded-md p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{LABELS[r.provider] ?? r.provider}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(r.fetched_at).toLocaleString()}
                  </div>
                  {r.error && (
                    <div className="text-[11px] text-destructive mt-0.5">{r.error}</div>
                  )}
                </div>
                <div className="text-right">
                  {exhausted ? (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertTriangle className="w-3 h-3 mr-1" /> exhausted
                    </Badge>
                  ) : unknown ? (
                    <Badge variant="secondary" className="text-[10px]">unknown</Badge>
                  ) : (
                    <Badge className="text-[10px] bg-[oklch(0.65_0.18_145)]/20 text-[oklch(0.65_0.18_145)]">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> {r.balance} credits
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
