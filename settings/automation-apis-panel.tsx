import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Zap, Workflow } from "lucide-react";
import { testWebhook } from "@/lib/webhooks.functions";
import { toast } from "sonner";

type TestResult = { ok: boolean; status: number; ms: number; body: string };

function WebhookRow({
  provider,
  title,
  placeholder,
  helpText,
  Icon,
  value,
  onSave,
}: {
  provider: "n8n" | "make";
  title: string;
  placeholder: string;
  helpText: string;
  Icon: React.ComponentType<{ className?: string }>;
  value: string;
  onSave: (v: string) => void;
}) {
  const [url, setUrl] = useState(value ?? "");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const test = useServerFn(testWebhook);

  const onTest = async () => {
    if (!url) {
      toast.error("Enter a webhook URL first");
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const r = await test({ data: { provider, url } });
      setResult(r as TestResult);
      if (r.ok) toast.success(`${title} responded ${r.status} in ${r.ms}ms`);
      else toast.error(`${title} test failed: ${r.body || r.status}`);
    } catch (e: any) {
      toast.error(e.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const isSet = !!value;

  return (
    <div className="space-y-2 border-b border-border pb-5 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <Label className="text-sm font-semibold">{title}</Label>
        {isSet ? (
          <Badge className="text-[10px] bg-[oklch(0.65_0.18_145)]/20 text-[oklch(0.65_0.18_145)]">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Saved
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">Not configured</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{helpText}</p>
      <div className="flex gap-2 flex-wrap">
        <Input
          type="url"
          inputMode="url"
          placeholder={placeholder}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== value && onSave(url)}
          className="flex-1 min-w-[260px] font-mono text-xs"
          maxLength={2000}
        />
        <Button
          variant="outline"
          onClick={onTest}
          disabled={testing || !url}
          type="button"
        >
          {testing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
          Test Connection
        </Button>
      </div>
      {result && (
        <div
          className={`flex items-start gap-2 text-xs rounded-md border p-2 ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="font-medium">
              {result.ok ? "Success" : "Failed"} · HTTP {result.status || "—"} · {result.ms}ms
            </div>
            {result.body && (
              <div className="font-mono text-[11px] break-all opacity-80 mt-0.5">
                {result.body}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AutomationApisPanel({
  settings,
  save,
}: {
  settings: any;
  save: (patch: any) => void;
}) {
  return (
    <Card className="p-6 bg-card space-y-5">
      <div>
        <h3 className="font-semibold">Automation Webhooks</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Connect external automation platforms. When a workflow runs the "Send to webhook" action,
          C4D will POST a JSON payload to the configured URL so your N8N or Make scenario can do
          additional processing (create tasks, sync CRMs, notify Slack, etc.).
        </p>
      </div>
      <WebhookRow
        provider="n8n"
        title="N8N Webhook URL"
        Icon={Workflow}
        placeholder="https://n8n.yourinstance.com/webhook/your-id"
        helpText="Paste a webhook URL from any N8N 'Webhook' trigger node."
        value={settings?.n8n_webhook_url ?? ""}
        onSave={(v) => save({ n8n_webhook_url: v || null })}
      />
      <WebhookRow
        provider="make"
        title="Make (Integromat) Webhook URL"
        Icon={Zap}
        placeholder="https://hook.make.com/your-webhook-id"
        helpText="Paste a hook URL from a Make 'Custom webhook' module."
        value={settings?.make_webhook_url ?? ""}
        onSave={(v) => save({ make_webhook_url: v || null })}
      />
      <p className="text-[11px] text-muted-foreground">
        URLs are stored in your team's protected settings row (RLS scoped to team members). Treat
        webhook URLs as secrets — anyone with the URL can post events to your automation.
      </p>
    </Card>
  );
}
