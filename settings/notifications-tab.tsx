import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Send, MessageSquare, Hash, Phone, AlertTriangle, History, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { sendTestNotification, listNotificationLog, retryQueuedNotifications } from "@/lib/notifications.functions";


type Channel = "slack" | "whatsapp" | "discord" | "telegram";

const EVENT_LABELS: Record<string, string> = {
  campaign_milestone: "Campaign milestone (e.g. sent 5K records)",
  campaign_paused: "Campaign paused (bounce rate, etc.)",
  zero_replies: "Zero replies after threshold",
  high_cost_per_lead: "High cost per lead",
  campaign_complete: "Campaign complete",
  workflow_executed: "Workflow executed",
  list_building_complete: "List building complete",
  login_approval: "Login approval request",
  system_alert: "System alert / errors",
};

function defaultPrefs(): { channels: Record<Channel, boolean>; events: Record<string, boolean> } {
  return {
    channels: { slack: false, whatsapp: false, discord: false, telegram: false },
    events: Object.keys(EVENT_LABELS).reduce((a, k) => ({ ...a, [k]: true }), {} as Record<string, boolean>),
  };
}

export function NotificationsTab({
  settings,
  save,
}: {
  settings: any;
  save: (patch: any) => any;
}) {
  const prefs = { ...defaultPrefs(), ...(settings?.notification_prefs ?? {}) };
  const channels = { ...defaultPrefs().channels, ...(prefs.channels ?? {}) };
  const events = { ...defaultPrefs().events, ...(prefs.events ?? {}) };

  const setChannel = (c: Channel, v: boolean) =>
    save({ notification_prefs: { ...prefs, channels: { ...channels, [c]: v } } });
  const setEvent = (e: string, v: boolean) =>
    save({ notification_prefs: { ...prefs, events: { ...events, [e]: v } } });

  const testFn = useServerFn(sendTestNotification);
  const [testing, setTesting] = useState<Channel | null>(null);
  const onTest = async (channel: Channel) => {
    setTesting(channel);
    try {
      const r = await testFn({ data: { channel, eventType: "system_alert" } });
      if ((r as any)?.ok) toast.success(`Test sent to ${channel}`);
      else toast.error((r as any)?.error ?? "Test failed");
    } catch (e: any) {
      toast.error(e?.message ?? "Test failed");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Slack */}
      <Card className="p-5 bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4" />
            <h3 className="font-semibold">Slack</h3>
          </div>
          <Switch checked={!!channels.slack} onCheckedChange={(v) => setChannel("slack", v)} />
        </div>
        <div>
          <Label>Webhook URL</Label>
          <Input type="password" defaultValue={settings?.slack_webhook ?? ""}
            onBlur={(e) => save({ slack_webhook: e.target.value })} />
        </div>
        <Button size="sm" variant="outline" disabled={testing === "slack"} onClick={() => onTest("slack")}>
          <Send className="w-3.5 h-3.5 mr-1.5" />Send test
        </Button>
      </Card>

      {/* WhatsApp */}
      <Card className="p-5 bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            <h3 className="font-semibold">WhatsApp (Meta Business)</h3>
          </div>
          <Switch checked={!!channels.whatsapp} onCheckedChange={(v) => setChannel("whatsapp", v)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Business Account ID</Label>
            <Input defaultValue={settings?.whatsapp_business_id ?? ""} onBlur={(e) => save({ whatsapp_business_id: e.target.value })} />
          </div>
          <div>
            <Label>Phone Number ID</Label>
            <Input defaultValue={settings?.whatsapp_phone_id ?? ""} onBlur={(e) => save({ whatsapp_phone_id: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Access Token</Label>
            <Input type="password" defaultValue={settings?.whatsapp_access_token ?? ""} onBlur={(e) => save({ whatsapp_access_token: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Default recipient phone (E.164, e.g. +15551234567)</Label>
            <Input defaultValue={settings?.whatsapp_default_to ?? ""} onBlur={(e) => save({ whatsapp_default_to: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Meta WhatsApp text messages only deliver to users who messaged your business in the last 24h. For broader outbound use approved templates.
        </p>
        <Button size="sm" variant="outline" disabled={testing === "whatsapp"} onClick={() => onTest("whatsapp")}>
          <Send className="w-3.5 h-3.5 mr-1.5" />Send test
        </Button>
      </Card>

      {/* Discord */}
      <Card className="p-5 bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            <h3 className="font-semibold">Discord</h3>
          </div>
          <Switch checked={!!channels.discord} onCheckedChange={(v) => setChannel("discord", v)} />
        </div>
        <div>
          <Label>Webhook URL</Label>
          <Input type="password" defaultValue={settings?.discord_webhook_url ?? ""} onBlur={(e) => save({ discord_webhook_url: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Server ID (optional)</Label>
            <Input defaultValue={settings?.discord_server_id ?? ""} onBlur={(e) => save({ discord_server_id: e.target.value })} />
          </div>
          <div>
            <Label>Channel ID (optional)</Label>
            <Input defaultValue={settings?.discord_channel_id ?? ""} onBlur={(e) => save({ discord_channel_id: e.target.value })} />
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={testing === "discord"} onClick={() => onTest("discord")}>
          <Send className="w-3.5 h-3.5 mr-1.5" />Send test
        </Button>
      </Card>

      {/* Telegram */}
      <Card className="p-5 bg-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            <h3 className="font-semibold">Telegram</h3>
          </div>
          <Switch checked={!!channels.telegram} onCheckedChange={(v) => setChannel("telegram", v)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Bot Token</Label>
            <Input type="password" defaultValue={settings?.telegram_bot_token ?? ""} onBlur={(e) => save({ telegram_bot_token: e.target.value })} />
          </div>
          <div>
            <Label>Chat ID</Label>
            <Input defaultValue={settings?.telegram_chat_id ?? ""} onBlur={(e) => save({ telegram_chat_id: e.target.value })} />
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={testing === "telegram"} onClick={() => onTest("telegram")}>
          <Send className="w-3.5 h-3.5 mr-1.5" />Send test
        </Button>
      </Card>

      {/* Event types + per-event channel routing */}
      <Card className="p-5 bg-card space-y-3">
        <h3 className="font-semibold">Event types &amp; routing</h3>
        <p className="text-xs text-muted-foreground">
          Toggle events on/off. Per-event channels override the global selection above — leave all
          off for an event to fall back to the globally enabled channels.
        </p>
        <div className="space-y-3">
          {Object.entries(EVENT_LABELS).map(([key, label]) => {
            const routed: Channel[] = Array.isArray(prefs?.eventChannels?.[key])
              ? (prefs.eventChannels[key] as Channel[])
              : [];
            const toggleRouted = (c: Channel, on: boolean) => {
              const next = on ? Array.from(new Set([...routed, c])) : routed.filter((x) => x !== c);
              save({
                notification_prefs: {
                  ...prefs,
                  eventChannels: { ...(prefs.eventChannels ?? {}), [key]: next },
                },
              });
            };
            return (
              <div key={key} className="border-b border-border last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <Switch checked={!!events[key]} onCheckedChange={(v) => setEvent(key, v)} />
                </div>
                {events[key] && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {(["slack", "whatsapp", "discord", "telegram"] as Channel[]).map((c) => (
                      <label key={c} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border bg-muted/30 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3 w-3"
                          checked={routed.includes(c)}
                          onChange={(e) => toggleRouted(c, e.target.checked)}
                        />
                        <span className="capitalize">{c}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <DeliveryHistoryCard />
    </div>
  );
}

function DeliveryHistoryCard() {
  const listFn = useServerFn(listNotificationLog);
  const retryFn = useServerFn(retryQueuedNotifications);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: { limit: 50 } });
      setRows((r as any)?.rows ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load history");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      const r: any = await retryFn();
      toast.success(`Retry complete — sent ${r?.processed ?? 0}, failed ${r?.failed ?? 0}, dead ${r?.dead ?? 0}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const failedCount = rows.filter((r) => r.status === "failed").length;

  const Icon = (s: string) =>
    s === "sent" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
    : s === "failed" ? <XCircle className="w-3.5 h-3.5 text-destructive" />
    : <MinusCircle className="w-3.5 h-3.5 text-muted-foreground" />;

  return (
    <Card className="p-5 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4" />
          <h3 className="font-semibold">Delivery history</h3>
          {failedCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">{failedCount} failed</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry now"}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notification activity yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
              <span className="mt-0.5">{Icon(r.status)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="capitalize text-[10px] py-0">{r.channel}</Badge>
                  <span className="font-medium truncate">{r.title ?? r.event_type}</span>
                  <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                {r.summary && <div className="text-muted-foreground truncate">{r.summary}</div>}
                {r.error && <div className="text-destructive truncate">{r.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

