import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMyBilling } from "@/lib/billing.functions";
import { submitSupportRequest } from "@/lib/support.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CreditCard, Loader2, Plus, Building2 } from "lucide-react";
import { toast } from "sonner";

/** Human labels for ledger operation keys. */
const OPERATION_LABELS: Record<string, string> = {
  firecrawl_search: "Lead search",
  firecrawl_scrape: "Page scraping",
  serper_search: "Web search",
  apollo_enrich: "Contact enrichment",
  seamless_search: "Contact search",
  hunter_find: "Email lookup",
  millionverifier_verify: "Email verification",
  realtime_voice_minutes: "AI call minutes",
};

export function BillingPanel() {
  const fn = useServerFn(getMyBilling);
  const [days, setDays] = useState("30");
  const [topUpOpen, setTopUpOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-billing", days],
    queryFn: () => fn({ data: { days: Number(days) } }),
    retry: false,
  });

  if (isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading billing…</Card>;
  }

  if (error) {
    return (
      <Card className="p-6 space-y-2">
        <div className="flex items-center gap-2 font-semibold">
          <CreditCard className="w-4 h-4" /> Billing
        </div>
        <p className="text-sm text-destructive">{(error as Error).message}</p>
        <p className="text-xs text-muted-foreground">
          If this mentions a missing table, the billing migrations haven't been applied to the
          database yet.
        </p>
      </Card>
    );
  }
  if (!data) return null;

  const { credits, consumption, subAccounts, totalCostUsd, team } = data;

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 font-semibold">
            <CreditCard className="w-4 h-4" /> Billing &amp; credits
          </div>
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setTopUpOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Top up credits
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Credits remaining</div>
            <div className="text-2xl font-bold mt-1">{credits.remaining.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              of {credits.total.toLocaleString()} allocated
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Used this period</div>
            <div className="text-2xl font-bold mt-1">{credits.used.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {credits.percentUsed === null ? "No allocation set" : `${credits.percentUsed}% of plan`}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground">Plan</div>
            <div className="text-2xl font-bold mt-1 capitalize">{team?.plan ?? "—"}</div>
            {team?.parent_team_id && (
              <Badge variant="outline" className="text-[10px] mt-1">Sub-account</Badge>
            )}
          </div>
        </div>

        {credits.percentUsed !== null && (
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={credits.percentUsed >= 90 ? "h-full bg-destructive" : "h-full bg-primary"}
              style={{ width: `${Math.min(100, credits.percentUsed)}%` }}
            />
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="font-semibold text-sm">What you're spending credits on</div>
        {consumption.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No usage recorded in the last {days} days.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-2">Activity</th>
                    <th className="p-2">Units</th>
                    <th className="p-2">Cost</th>
                    <th className="p-2">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {consumption.map((c: any) => {
                    const share = totalCostUsd > 0 ? Math.round((c.costUsd / totalCostUsd) * 100) : 0;
                    return (
                      <tr key={c.operation} className="border-t border-border">
                        <td className="p-2">{OPERATION_LABELS[c.operation] ?? c.operation}</td>
                        <td className="p-2">{c.units.toLocaleString()}</td>
                        <td className="p-2">${c.costUsd.toFixed(4)}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${share}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{share}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Total cost behind your marketing, last {days} days: </span>
              <span className="font-semibold">${totalCostUsd.toFixed(2)}</span>
            </div>
          </>
        )}
      </Card>

      {subAccounts.length > 0 && (
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Building2 className="w-4 h-4" /> Sub-account credits
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2">Account</th>
                  <th className="p-2">Plan</th>
                  <th className="p-2">Used</th>
                  <th className="p-2">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {subAccounts.map((s: any) => {
                  const total = Number(s.credits_total ?? 0);
                  const used = Number(s.credits_used ?? 0);
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-2">
                        <span className="inline-flex items-center gap-2">
                          {s.brand_color && (
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.brand_color }} />
                          )}
                          {s.name}
                        </span>
                      </td>
                      <td className="p-2 capitalize">{s.plan}</td>
                      <td className="p-2">{used.toLocaleString()}</td>
                      <td className="p-2">{Math.max(0, total - used).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} />
    </div>
  );
}

/** Credit top-ups are handled by request rather than self-serve checkout. */
function TopUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const submit = useServerFn(submitSupportRequest);
  const qc = useQueryClient();
  const [amount, setAmount] = useState("10000");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      submit({
        data: {
          category: "credits",
          subject: `Credit top-up request: ${amount} credits`,
          message: note.trim() || `Requesting ${amount} additional credits for our account.`,
        } as never,
      }),
    onSuccess: () => {
      toast.success("Request sent — we'll follow up by email.");
      onOpenChange(false);
      setNote("");
      qc.invalidateQueries({ queryKey: ["my-support-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not send request"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request more credits</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label>How many credits?</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Anything we should know? <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ramping up outreach next month…"
              maxLength={4000}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This sends a request to the team, who will add the credits and email you back.
            You can track it under Credits.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || Number(amount) < 1}>
            {mut.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Sending…</> : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
