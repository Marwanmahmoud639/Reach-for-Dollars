import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, RotateCcw, Plus, Shield } from "lucide-react";
import { DEFAULT_BLOCKED_KEYWORDS } from "@/lib/blocked-keywords";
import { toast } from "sonner";

export function BlockedKeywordsPanel({ settings, save }: { settings: any; save: (p: any) => any }) {
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setList(Array.isArray(settings?.blocked_keywords) ? settings.blocked_keywords : DEFAULT_BLOCKED_KEYWORDS);
  }, [settings?.blocked_keywords]);

  const persist = async (next: string[]) => {
    setBusy(true);
    try {
      await save({ blocked_keywords: next });
      setList(next);
    } finally { setBusy(false); }
  };

  const add = async () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (list.includes(v)) { toast.error("Already in the list"); return; }
    setDraft("");
    await persist([...list, v]);
  };

  const remove = async (kw: string) => {
    await persist(list.filter((k) => k !== kw));
  };

  const reset = async () => {
    if (!confirm("Reset blocked keywords to the default list? Your custom additions will be lost.")) return;
    await persist([...DEFAULT_BLOCKED_KEYWORDS]);
    toast.success("Reset to defaults");
  };

  return (
    <Card className="p-6 bg-card space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Blocked keywords</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            SMS campaigns containing these words are <strong>hard-blocked</strong>. Email campaigns show a warning
            and admins can override. AI-personalized variants are re-checked per contact.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a word or phrase…"
          className="h-9"
        />
        <Button onClick={add} disabled={busy || !draft.trim()} size="sm"><Plus className="w-4 h-4 mr-1" />Add</Button>
        <Button onClick={reset} disabled={busy} variant="outline" size="sm"><RotateCcw className="w-4 h-4 mr-1" />Reset</Button>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto p-2 rounded-lg bg-muted/20 border border-border">
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-1 py-2">No blocked keywords — anything will send.</p>
        )}
        {list.map((kw) => (
          <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-background border border-border">
            {kw}
            <button onClick={() => remove(kw)} disabled={busy} className="hover:bg-destructive/20 rounded-full p-0.5" aria-label={`Remove ${kw}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className="text-[10px]">{list.length}</Badge>
        keyword{list.length === 1 ? "" : "s"} in your block list
      </div>
    </Card>
  );
}
