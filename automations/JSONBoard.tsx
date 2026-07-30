import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Check, ClipboardPaste, AlertCircle, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Automation schema (loose — allows extra keys but enforces shape).
export const AutomationSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  trigger: z
    .object({ type: z.string().min(1) })
    .passthrough()
    .optional(),
  blocks: z.array(z.record(z.string(), z.any())).optional().default([]),
  steps: z.array(z.record(z.string(), z.any())).optional(),
  stop_conditions: z.array(z.any()).optional().default([]),
}).passthrough();


/** Lightweight JSON highlighter — themed via semantic tokens. */
function highlight(json: string): string {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-amber-500"; // numbers
      if (/^"/.test(match)) {
        cls = /:$/.test(match)
          ? "text-sky-400 font-medium" // key
          : "text-emerald-500"; // string
      } else if (/true|false/.test(match)) {
        cls = "text-violet-400";
      } else if (/null/.test(match)) {
        cls = "text-muted-foreground italic";
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

export function JSONBoard({
  value,
  className,
  filename,
}: {
  value: unknown;
  className?: string;
  filename?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => (typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    [value],
  );
  const html = useMemo(() => highlight(text), [text]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied JSON to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  };

  const onDownload = () => {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (filename || "automation") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
          {filename ? `${filename}.json` : "automation.json"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onDownload} className="h-7 text-xs">
            Download
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopy} className="h-7 text-xs">
            {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </div>
      </div>
      <pre
        className="p-4 text-xs font-mono leading-relaxed overflow-auto max-h-[420px] bg-background/40"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/** Shallow diff between current and incoming objects — keys added/removed/changed. */

function diffObjects(current: any, next: any): { added: string[]; removed: string[]; changed: string[] } {
  const a = current && typeof current === "object" ? current : {};
  const b = next && typeof next === "object" ? next : {};
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const k of bKeys) if (!aKeys.has(k)) added.push(k);
  for (const k of aKeys) if (!bKeys.has(k)) removed.push(k);
  for (const k of bKeys) {
    if (aKeys.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
  }
  return { added, removed, changed };
}

export function PasteJSONDialog({
  onImport,
  required = ["name"],
  trigger,
  current,
}: {
  onImport: (json: string) => Promise<void> | void;
  required?: string[];
  trigger?: React.ReactNode;
  /** Optional current automation object to diff against. */
  current?: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsedResult = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const obj = JSON.parse(text);
      const schemaResult = AutomationSchema.safeParse(obj);
      if (!schemaResult.success) {
        const issue = schemaResult.error.issues[0];
        return { ok: false as const, error: `${issue.path.join(".") || "root"}: ${issue.message}` };
      }
      const missing = required.filter((k) => !(k in obj));
      if (missing.length) return { ok: false as const, error: `Missing required fields: ${missing.join(", ")}` };
      return { ok: true as const, obj };
    } catch (e: any) {
      return { ok: false as const, error: `Invalid JSON: ${e.message}` };
    }
  }, [text, required]);

  const diff = useMemo(() => {
    if (!current || !parsedResult?.ok) return null;
    return diffObjects(current, parsedResult.obj);
  }, [current, parsedResult]);

  const handleImport = async () => {
    if (!parsedResult) { setError("Paste JSON to continue"); return; }
    if (!parsedResult.ok) { setError(parsedResult.error); return; }
    setError(null);
    setBusy(true);
    try {
      await onImport(text);
      setOpen(false);
      setText("");
      toast.success("Automation imported");
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <ClipboardPaste className="w-4 h-4 mr-1" /> Paste JSON
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import automation from JSON</DialogTitle>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          rows={14}
          placeholder='{"name":"Hot Lead Sequence","trigger":{...},"blocks":[...]}'
          className="font-mono text-xs"
        />
        {parsedResult?.ok && diff && (diff.added.length + diff.removed.length + diff.changed.length > 0) && (
          <div className="text-xs rounded-md border border-border bg-muted/30 p-2 space-y-1">
            <div className="flex items-center gap-1.5 font-medium">
              <GitCompare className="w-3.5 h-3.5" /> Changes vs current
            </div>
            {diff.added.length > 0 && (
              <div><span className="text-emerald-500">+ added:</span> {diff.added.join(", ")}</div>
            )}
            {diff.removed.length > 0 && (
              <div><span className="text-destructive">- removed:</span> {diff.removed.join(", ")}</div>
            )}
            {diff.changed.length > 0 && (
              <div><span className="text-amber-500">~ changed:</span> {diff.changed.join(", ")}</div>
            )}
          </div>
        )}
        {parsedResult?.ok && diff && diff.added.length + diff.removed.length + diff.changed.length === 0 && (
          <div className="text-xs text-muted-foreground">No changes vs current.</div>
        )}
        {(error || (parsedResult && !parsedResult.ok)) && (
          <div className="flex items-start gap-2 text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error ?? (parsedResult as any)?.error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={busy || (parsedResult ? !parsedResult.ok : false)}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

