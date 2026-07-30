import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  provisionAccountByEmail, lookupAccountByEmail, adjustCredits,
  listRateCard, updateRateCardEntry, getBillingOverview,
} from "@/lib/provisioning.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, UserCog, Receipt } from "lucide-react";
import { toast } from "sonner";

const FEATURES = [
  { key: "ai_caller", label: "AI Caller", hint: "Autonomous AI voice calls" },
  { key: "dialer", label: "Dialer", hint: "Click-to-call and power dialing" },
  { key: "sms", label: "SMS", hint: "Outbound text messaging" },
  { key: "email_campaigns", label: "Email Campaigns", hint: "Bulk and sequenced email" },
  { key: "discovery", label: "Discovery", hint: "Lead search and enrichment" },
  { key: "social_dm", label: "Social DMs", hint: "LinkedIn / Facebook / Instagram" },
] as const;

export function AccountProvisioningCard() {
  const lookup = useServerFn(lookupAccountByEmail);
  const provision = useServerFn(provisionAccountByEmail);
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState<any>(null);

  const [plan, setPlan] = useState<"starter" | "growth" | "agency">("starter");
  const [credits, setCredits] = useState("0");
  const [seats, setSeats] = useState("1");
  const [brandColor, setBrandColor] = useState("#6366f1");
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [dailyEmail, setDailyEmail] = useState("300");
  const [dailySms, setDailySms] = useState("100");
  const [aiMinutes, setAiMinutes] = useState("0");
  const [overage, setOverage] = useState(false);

  const lookupMut = useMutation({
    mutationFn: () => lookup({ data: { email } }),
    onSuccess: (r: any) => {
      if (!r.found) {
        toast.error("No account for that email — they need to sign up or be invited first.");
        setLoaded(null);
        return;
      }
      setLoaded(r);
      setPlan(r.team?.plan ?? "starter");
      setCredits(String(r.team?.credits_total ?? 0));
      setSeats(String(r.team?.seat_limit ?? 1));
      setBrandColor(r.team?.brand_color ?? "#6366f1");
      const e = r.entitlements ?? {};
      setFeatures(Object.fromEntries(FEATURES.map((f) => [f.key, !!e[f.key]])));
      setDailyEmail(String(e.daily_email_limit ?? 300));
      setDailySms(String(e.daily_sms_limit ?? 100));
      setAiMinutes(String(e.monthly_ai_call_minutes ?? 0));
      setOverage(!!e.overage_allowed);
    },
    onError: (e: any) => toast.error(e?.message ?? "Lookup failed"),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      provision({
        data: {
          email,
          plan,
          creditsTotal: Number(credits),
          seatLimit: Number(seats),
          brandColor: brandColor || null,
          features: FEATURES.filter((f) => features[f.key]).map((f) => f.key),
          dailyEmailLimit: Number(dailyEmail),
          dailySmsLimit: Number(dailySms),
          monthlyAiCallMinutes: Number(aiMinutes),
          overageAllowed: overage,
        } as never,
      }),
    onSuccess: () => {
      toast.success("Account updated");
      qc.invalidateQueries({ queryKey: ["admin-teams"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2 font-semibold">
        <UserCog className="w-4 h-4" /> Provision account
      </div>
      <p className="text-sm text-muted-foreground">
        Look up a user by email, then set their plan, credits, seats, branding, and exactly
        which paid features they can use. Unchecking a feature revokes it immediately —
        the server refuses the action, not just the button.
      </p>

      <div className="flex gap-2">
        <Input
          value={email}
          onChange={(e) => { setEmail(e.target.value); setLoaded(null); }}
          placeholder="user@company.com"
          type="email"
        />
        <Button
          variant="outline"
          onClick={() => lookupMut.mutate()}
          disabled={lookupMut.isPending || !email.includes("@")}
        >
          {lookupMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {loaded && (
        <div className="space-y-5 border-t border-border pt-5">
          <div className="text-sm">
            <span className="font-medium">{loaded.team?.name}</span>
            {loaded.team?.parent_team_id && <Badge variant="outline" className="ml-2 text-[10px]">Sub-account</Badge>}
            <div className="text-xs text-muted-foreground">
              {loaded.user?.email} · {loaded.team?.credits_used ?? 0} of {loaded.team?.credits_total ?? 0} credits used
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Plan label</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="agency">Agency</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A label only. Credits, features, and limits below are set independently, so
                custom arrangements don't have to fit a preset.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>Total credits</Label>
              <Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
              <TopUpCredits
                teamId={loaded.team?.id}
                onDone={(newTotal) => { setCredits(String(newTotal)); lookupMut.mutate(); }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Team member seats</Label>
              <Input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Brand colour</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="w-14 p-1 h-9"
                />
                <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} placeholder="#6366f1" />
              </div>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Enabled features</Label>
            <div className="grid gap-2 md:grid-cols-2">
              {FEATURES.map((f) => (
                <label key={f.key} className="flex items-start gap-2 text-sm border border-border rounded-lg p-2.5">
                  <Switch
                    checked={!!features[f.key]}
                    onCheckedChange={(v) => setFeatures((p) => ({ ...p, [f.key]: v }))}
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Daily email limit</Label>
              <Input type="number" min={0} value={dailyEmail} onChange={(e) => setDailyEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Daily SMS limit</Label>
              <Input type="number" min={0} value={dailySms} onChange={(e) => setDailySms(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>AI call minutes / month</Label>
              <Input type="number" min={0} value={aiMinutes} onChange={(e) => setAiMinutes(e.target.value)} />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Switch checked={overage} onCheckedChange={setOverage} />
            <span>
              <span className="font-medium">Allow overage</span>
              <span className="block text-xs text-muted-foreground">
                Sends past the daily cap draw platform credits instead of being refused.
              </span>
            </span>
          </label>

          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…</> : "Save account"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Additive credit top-up.
 *
 * Kept separate from the "total credits" field because granting more is the
 * everyday action, and expressing it as a new absolute total is where
 * arithmetic slips happen.
 */
function TopUpCredits({ teamId, onDone }: { teamId?: string; onDone: (total: number) => void }) {
  const adjust = useServerFn(adjustCredits);
  const [amount, setAmount] = useState("");

  const mut = useMutation({
    mutationFn: () => adjust({ data: { teamId: teamId!, delta: Number(amount) } as never }),
    onSuccess: (r: any) => {
      toast.success(`Credits updated — new total ${r.creditsTotal.toLocaleString()}`);
      setAmount("");
      onDone(r.creditsTotal);
    },
    onError: (e: any) => toast.error(e?.message ?? "Top-up failed"),
  });

  if (!teamId) return null;

  return (
    <div className="flex gap-2 items-center">
      <Input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Add / remove"
        className="h-8 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={mut.isPending || !amount || Number(amount) === 0}
        onClick={() => mut.mutate()}
      >
        {mut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
      </Button>
    </div>
  );
}

export function BillingRateCard() {
  const list = useServerFn(listRateCard);
  const update = useServerFn(updateRateCardEntry);
  const overview = useServerFn(getBillingOverview);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["rate-card"], queryFn: () => list() });
  const { data: spend } = useQuery({ queryKey: ["billing-overview"], queryFn: () => overview({ data: { days: 30 } }) });

  const mut = useMutation({
    mutationFn: (row: any) =>
      update({ data: { unit_key: row.unit_key, cost_usd: Number(row.cost_usd), credits_charged: Number(row.credits_charged) } as never }),
    onSuccess: () => { toast.success("Rate updated"); qc.invalidateQueries({ queryKey: ["rate-card"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const rows = data?.rows ?? [];

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2 font-semibold">
        <Receipt className="w-4 h-4" /> Platform rate card
      </div>
      <p className="text-sm text-muted-foreground">
        What each unit costs you wholesale versus what tenants are charged in credits.
        Visible to super admins only. Actual spend below comes from the cost ledger, not
        these estimates — so it reflects what really happened.
      </p>

      {spend && (
        <div className="text-sm">
          <span className="text-muted-foreground">Actual vendor spend, last {spend.windowDays} days: </span>
          <span className="font-semibold">${spend.actualSpendUsd.toFixed(2)}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-2">Unit</th>
              <th className="p-2">Vendor</th>
              <th className="p-2">Your cost (USD)</th>
              <th className="p-2">Credits charged</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <RateRow key={r.unit_key} row={r} onSave={(next) => mut.mutate(next)} saving={mut.isPending} />
            ))}
          </tbody>
        </table>
      </div>

      {(spend?.byOperation?.length ?? 0) > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">Actual spend by operation</div>
          <div className="space-y-1">
            {(spend?.byOperation ?? []).slice(0, 10).map((o: any) => (
              <div key={o.operation} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{o.operation}</span>
                <span>${o.costUsd.toFixed(4)} · {o.calls} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function RateRow({ row, onSave, saving }: { row: any; onSave: (r: any) => void; saving: boolean }) {
  const [cost, setCost] = useState(String(row.cost_usd));
  const [credits, setCredits] = useState(String(row.credits_charged));
  const dirty = cost !== String(row.cost_usd) || credits !== String(row.credits_charged);

  return (
    <tr className="border-t border-border">
      <td className="p-2">{row.label}</td>
      <td className="p-2 text-xs text-muted-foreground">{row.vendor ?? "—"}</td>
      <td className="p-2">
        <Input value={cost} onChange={(e) => setCost(e.target.value)} className="h-8 w-28 font-mono text-xs" />
      </td>
      <td className="p-2">
        <Input value={credits} onChange={(e) => setCredits(e.target.value)} className="h-8 w-24 font-mono text-xs" />
      </td>
      <td className="p-2">
        {dirty && (
          <Button size="sm" variant="outline" disabled={saving}
            onClick={() => onSave({ ...row, cost_usd: cost, credits_charged: credits })}>
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}
