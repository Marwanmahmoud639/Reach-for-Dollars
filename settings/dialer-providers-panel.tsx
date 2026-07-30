import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  listProviders,
  upsertProvider,
  setActiveProvider,
  deleteProvider,
} from "@/lib/dialer.functions";
import { ALL_PROVIDERS } from "@/lib/dialer/registry";
import { Phone, Check, Trash2 } from "lucide-react";

type SavedRow = {
  id: string;
  provider: string;
  is_active: boolean;
  from_number: string | null;
  display_name: string | null;
  credentials: Record<string, string>;
};

export function DialerProvidersPanel() {
  const list = useServerFn(listProviders);
  const upsert = useServerFn(upsertProvider);
  const activate = useServerFn(setActiveProvider);
  const remove = useServerFn(deleteProvider);

  const [rows, setRows] = useState<SavedRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [fromNumbers, setFromNumbers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const { providers } = await list();
    setRows(providers as SavedRow[]);
    const fn: Record<string, string> = {};
    for (const r of providers as SavedRow[]) fn[r.provider] = r.from_number ?? "";
    setFromNumbers(fn);
  };

  useEffect(() => {
    refresh().catch((e) => toast.error(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved = (pid: string) => rows.find((r) => r.provider === pid);

  const save = async (pid: string) => {
    setBusy(pid);
    try {
      await upsert({
        data: {
          provider: pid as any,
          from_number: fromNumbers[pid] || null,
          credentials: drafts[pid] ?? {},
        },
      });
      setDrafts((d) => ({ ...d, [pid]: {} }));
      await refresh();
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const makeActive = async (pid: string) => {
    setBusy(pid);
    try {
      await activate({ data: { provider: pid as any } });
      await refresh();
      toast.success("Active provider updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  };

  const del = async (pid: string) => {
    setBusy(pid);
    try {
      await remove({ data: { provider: pid as any } });
      await refresh();
      toast.success("Removed");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  };

  const projectId = "cf04a8da-2943-49b6-b855-3864ef0edc8f";
  const inboundUrl = (p: string) =>
    `https://project--${projectId}.lovable.app/api/public/dialer/sms-inbound/${p}`;

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-card">
        <div className="text-sm text-muted-foreground">
          Connect any dialer/SMS provider. Set one as <b>Active</b> — the dial pad and SMS bubble will use it.
          For incoming SMS, paste the inbound webhook URL into your provider's dashboard.
        </div>
      </Card>

      {ALL_PROVIDERS.map((p) => {
        const row = saved(p.id);
        const draft = drafts[p.id] ?? {};
        return (
          <Card key={p.id} className="p-4 bg-card">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary" />
                <div className="font-semibold">{p.label}</div>
                {row?.is_active && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Active</Badge>}
                {row && !row.is_active && <Badge variant="outline">Configured</Badge>}
              </div>
              <div className="flex items-center gap-2">
                {row && !row.is_active && (
                  <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => makeActive(p.id)}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Set Active
                  </Button>
                )}
                {row && (
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => del(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From Number (E.164)</Label>
                <Input
                  placeholder="+15551234567"
                  value={fromNumbers[p.id] ?? ""}
                  onChange={(e) => setFromNumbers((s) => ({ ...s, [p.id]: e.target.value }))}
                />
              </div>
              {p.credentialFields.map((f) => (
                <div key={f.key}>
                  <Label className="text-xs">
                    {f.label} {f.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    type={f.secret ? "password" : "text"}
                    placeholder={
                      f.secret && row?.credentials?.[f.key]
                        ? `Saved (${row.credentials[f.key]}). Type to replace.`
                        : f.placeholder
                    }
                    value={draft[f.key] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [p.id]: { ...(d[p.id] ?? {}), [f.key]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-muted-foreground font-mono break-all">
                Inbound SMS webhook: {inboundUrl(p.id)}
              </div>
              <Button size="sm" disabled={busy === p.id} onClick={() => save(p.id)}>
                Save
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
