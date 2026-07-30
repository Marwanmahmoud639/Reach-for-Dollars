import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useServerFn } from "@tanstack/react-start";
import { addSendingDomain, addInbox, listSendingDomains, verifyDns } from "@/lib/sending.functions";
import { listEmailAccounts, addEmailAccount, updateEmailAccount, deleteEmailAccount, sendTestEmail } from "@/lib/email-accounts.functions";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, CheckCircle2, XCircle, RefreshCw, Trash2, Send, Mail } from "lucide-react";
import { toast } from "sonner";

export function CompliancePanel({ settings, save }: { settings: any; save: (p: any) => void }) {
  if (!settings) return null;
  return (
    <Card className="p-6 bg-card space-y-6">
      <div>
        <h3 className="font-semibold text-sm mb-3">TCPA Sending Window</h3>
        <label className="flex items-center gap-2 text-sm mb-3">
          <input
            type="checkbox"
            defaultChecked={settings.enforce_tcpa_hours ?? true}
            onChange={(e) => save({ enforce_tcpa_hours: e.target.checked })}
          />
          Enforce TCPA 8 AM – 9 PM SMS window (per contact local timezone)
        </label>
        <div>
          <Label>Default sending strategy</Label>
          <select
            className="block w-full max-w-xs mt-1 bg-background border border-input rounded-md h-9 px-2 text-sm"
            defaultValue={settings.sending_strategy ?? "spread"}
            onChange={(e) => save({ sending_strategy: e.target.value })}
          >
            <option value="immediate">Immediate (ignore window)</option>
            <option value="spread">Spread across the day</option>
            <option value="batched">Batched at top of hour</option>
          </select>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="font-semibold text-sm mb-3">DNC Scrubbing</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Provider</Label>
            <select
              className="block w-full mt-1 bg-background border border-input rounded-md h-9 px-2 text-sm"
              defaultValue={settings.dnc_api_provider ?? ""}
              onChange={(e) => save({ dnc_api_provider: e.target.value })}
            >
              <option value="">— None (use internal list only) —</option>
              <option value="freednc">FreeDNC</option>
              <option value="dnc_scrub">DNC.com</option>
              <option value="ringba">Ringba</option>
            </select>
          </div>
          <div>
            <Label>API key</Label>
            <Input
              type="password"
              defaultValue={settings.dnc_api_key ?? ""}
              onBlur={(e) => save({ dnc_api_key: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="font-semibold text-sm mb-3">SMS Opt-Out Footer</h3>
        <Input
          defaultValue={settings.sms_opt_out_footer ?? "Reply STOP to opt out."}
          onBlur={(e) => save({ sms_opt_out_footer: e.target.value })}
          placeholder="Reply STOP to opt out."
        />
        <p className="text-xs text-muted-foreground mt-2">
          Appended to every outbound SMS automatically. Required for TCPA compliance.
        </p>
      </div>
    </Card>
  );
}

export function EmailInfraPanel() {
  const list = useServerFn(listSendingDomains);
  const add = useServerFn(addSendingDomain);
  const addBox = useServerFn(addInbox);
  const verify = useServerFn(verifyDns);

  const [domains, setDomains] = useState<any[]>([]);
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const r = await list();
    setDomains(r.domains);
    setInboxes(r.inboxes);
  };

  useEffect(() => { refresh().catch(() => {}); }, []);

  const onAdd = async () => {
    if (!newDomain) return;
    setBusy(true);
    try {
      await add({ data: { domain: newDomain } });
      toast.success(`Added ${newDomain}`);
      setNewDomain("");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add domain");
    } finally { setBusy(false); }
  };

  const onVerify = async (id: string) => {
    try {
      const r = await verify({ data: { domainId: id } });
      toast.success(`SPF: ${r.spf ? "✓" : "✗"}  DKIM: ${r.dkim ? "✓" : "✗"}  DMARC: ${r.dmarc ? "✓" : "✗"}`);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Verify failed");
    }
  };

  return (
    <div className="space-y-5">
      <ConnectedEmailAccounts />



      <Card className="p-6 bg-card space-y-5">
      <div>
        <h3 className="font-semibold text-sm mb-3">Dedicated Sending Domains</h3>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="send.example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            className="max-w-sm"
          />
          <Button onClick={onAdd} disabled={busy}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>
        {domains.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sending domains yet. Add a subdomain (e.g. <code className="text-xs">send.yourdomain.com</code>) and we'll generate SPF / DKIM / DMARC records for you.
          </p>
        )}
        <div className="space-y-3">
          {domains.map((d) => (
            <Card key={d.id} className="p-4 bg-muted/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium font-mono text-sm">{d.domain}</div>
                  <div className="flex gap-3 mt-2 text-xs">
                    <Flag label="SPF" ok={d.spf_configured} />
                    <Flag label="DKIM" ok={d.dkim_configured} />
                    <Flag label="DMARC" ok={d.dmarc_configured} />
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onVerify(d.id)}>
                  <RefreshCw className="w-3 h-3 mr-1" />Verify DNS
                </Button>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show DNS records to add at your registrar
                </summary>
                <pre className="mt-2 p-2 bg-background/60 rounded overflow-x-auto font-mono">
{`TXT  ${d.domain}
      v=spf1 include:_spf.sendgrid.net include:mailgun.org -all

TXT  cfd._domainkey.${d.domain}
      ${d.dkim_public_key ?? "(generated on first verify)"}

TXT  _dmarc.${d.domain}
      v=DMARC1; p=quarantine; rua=mailto:dmarc@${d.domain}`}
                </pre>
              </details>
              <InboxBlock
                domain={d}
                inboxes={inboxes.filter((i) => i.domain_id === d.id)}
                onAdd={async (email) => {
                  try {
                    await addBox({ data: { domainId: d.id, email } });
                    toast.success(`Inbox ${email} added (warm-up stage 1)`);
                    await refresh();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed");
                  }
                }}
              />
            </Card>
          ))}
        </div>
      </div>
      </Card>
    </div>
  );
}

function Flag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-emerald-500" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function InboxBlock({ domain, inboxes, onAdd }: { domain: any; inboxes: any[]; onAdd: (email: string) => void }) {
  const [email, setEmail] = useState("");
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="text-xs font-medium mb-2">Inboxes on this domain</div>
      <div className="space-y-1.5 mb-2">
        {inboxes.length === 0 && <div className="text-xs text-muted-foreground">No inboxes configured yet.</div>}
        {inboxes.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-xs">
            <span className="font-mono">{i.email_address}</span>
            <Badge variant="secondary" className="text-[10px]">
              Warm-up stage {i.warm_up_stage} · {i.sent_today ?? 0} / {i.daily_limit} today
            </Badge>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`hello@${domain.domain}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => { if (email) { onAdd(email); setEmail(""); } }}
        >
          Add inbox
        </Button>
      </div>
    </div>
  );
}

// ─── Connected email accounts (multi-provider, load-balanced sending) ─────────
export function ConnectedEmailAccounts() {
  const list = useServerFn(listEmailAccounts);
  const add = useServerFn(addEmailAccount);
  const update = useServerFn(updateEmailAccount);
  const del = useServerFn(deleteEmailAccount);
  const test = useServerFn(sendTestEmail);

  const [accounts, setAccounts] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [form, setForm] = useState<any>({ provider: "brevo", from_email: "", from_name: "", daily_limit: 200, api_key: "" });

  const refresh = async () => {
    try { const r = await list(); setAccounts(r.accounts); } catch { /* ignore */ }
  };
  useEffect(() => { refresh(); }, []);

  const onAdd = async () => {
    if (!form.from_email) return toast.error("From email is required");
    setBusy(true);
    try {
      await add({ data: { ...form, daily_limit: Number(form.daily_limit) || 200 } });
      toast.success("Email account added");
      setForm({ provider: "brevo", from_email: "", from_name: "", daily_limit: 200, api_key: "" });
      setAdding(false);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Failed to add account"); }
    finally { setBusy(false); }
  };

  const toggle = async (id: string, is_active: boolean) => {
    await update({ data: { id, is_active } }).catch((e: any) => toast.error(e?.message));
    refresh();
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this email account?")) return;
    await del({ data: { id } }).catch((e: any) => toast.error(e?.message));
    refresh();
  };
  const runTest = async () => {
    if (!testTo) return toast.error("Enter a recipient email");
    setBusy(true);
    try {
      const r = await test({ data: { to: testTo } });
      toast.success(`Sent via ${r.used.provider}`);
    } catch (e: any) { toast.error(e?.message ?? "Test failed"); }
    finally { setBusy(false); }
  };

  const totalCap = accounts.filter(a => a.is_active).reduce((s, a) => s + (a.daily_limit || 0), 0);

  return (
    <Card className="p-6 bg-card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2"><Mail className="w-4 h-4" /> Connected sending accounts</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Connect multiple Gmail, Brevo, or relay accounts. Sends are load-balanced across active
            accounts (least-used first) to spread volume and avoid rate limits / spam flags.
            {accounts.length > 0 && <> Combined daily capacity: <strong>{totalCap.toLocaleString()}</strong> emails.</>}
          </p>
        </div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-4 h-4 mr-1" />Add account</Button>}
      </div>

      {adding && (
        <Card className="p-4 bg-muted/30 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="brevo">Brevo (Sendinblue)</SelectItem>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="smtp">Relay (SendGrid/Mailgun API)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Label (optional)</Label><Input value={form.label ?? ""} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Sales inbox 1" /></div>
            <div><Label>From email</Label><Input type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} placeholder="you@yourdomain.com" /></div>
            <div><Label>From name</Label><Input value={form.from_name ?? ""} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Your Name" /></div>
            <div><Label>Daily limit</Label><Input type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} /></div>
            {form.provider === "brevo" && (
              <div><Label>Brevo API key</Label><Input type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="xkeysib-…" /></div>
            )}
            {form.provider === "smtp" && (
              <>
                <div><Label>Relay host</Label><Input value={form.smtp_host ?? ""} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="api.sendgrid.com" /></div>
                <div><Label>Relay API key</Label><Input type="password" value={form.api_key ?? ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })} /></div>
              </>
            )}
            {form.provider === "gmail" && (
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                Gmail uses an OAuth refresh token. Paste a token obtained via your Google OAuth consent flow
                (server env needs <code>GOOGLE_OAUTH_CLIENT_ID/SECRET</code>).
                <Input className="mt-1" type="password" value={form.oauth_refresh_token ?? ""} onChange={(e) => setForm({ ...form, oauth_refresh_token: e.target.value })} placeholder="1//0g… refresh token" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onAdd} disabled={busy}>Save account</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {accounts.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No sending accounts yet. Add at least one to start sending.</p>
      )}

      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{a.from_email}</span>
                <Badge variant="secondary" className="text-[10px] uppercase">{a.provider}</Badge>
                {a.label && <span className="text-xs text-muted-foreground truncate">· {a.label}</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {a.sent_today}/{a.daily_limit} sent today
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <Switch checked={a.is_active} onCheckedChange={(v) => toggle(a.id, v)} />
                <span className="text-xs text-muted-foreground">{a.is_active ? "Active" : "Paused"}</span>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(a.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          </div>
        ))}
      </div>

      {accounts.length > 0 && (
        <div className="flex items-end gap-2 pt-2 border-t border-border">
          <div className="flex-1 max-w-xs">
            <Label className="text-xs">Send a test (uses the load balancer)</Label>
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          </div>
          <Button size="sm" variant="outline" onClick={runTest} disabled={busy}><Send className="w-4 h-4 mr-1" />Send test</Button>
        </div>
      )}
    </Card>
  );
}
