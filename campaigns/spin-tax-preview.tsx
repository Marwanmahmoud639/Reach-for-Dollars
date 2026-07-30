import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shuffle, Sparkles } from "lucide-react";
import { generateSpinTaxVariations, countSpinTaxVariations } from "@/lib/spin-tax";

export function SpinTaxPreview({ template, subject }: { template: string; subject?: string }) {
  const [open, setOpen] = useState(false);

  const bodyCount = useMemo(() => countSpinTaxVariations(template), [template]);
  const subjectCount = useMemo(() => (subject ? countSpinTaxVariations(subject) : 0), [subject]);

  const variations = useMemo(() => generateSpinTaxVariations(template, 200), [template]);
  const subjectVariations = useMemo(
    () => (subject ? generateSpinTaxVariations(subject, 50) : []),
    [subject],
  );

  const hasSpin = bodyCount > 1 || subjectCount > 1;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          disabled={!template?.trim()}
        >
          <Shuffle className="w-3.5 h-3.5 mr-1.5" />
          Preview Variations
        </Button>
        {hasSpin ? (
          <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px]">
            <Sparkles className="w-3 h-3 mr-1" />
            {bodyCount.toLocaleString()} body{subjectCount > 1 ? ` × ${subjectCount} subject` : ""} variations
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Use {`{a|b|c}`} for spin tax variations
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Sora" }}>
              Spin Tax Variations
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{bodyCount.toLocaleString()} body variations</Badge>
              {subject && (
                <Badge variant="secondary">{subjectCount.toLocaleString()} subject variations</Badge>
              )}
            </div>

            {subject && subjectVariations.length > 1 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Subjects ({subjectVariations.length} shown)
                </div>
                <div className="space-y-1.5">
                  {subjectVariations.map((v, i) => (
                    <div key={i} className="p-2 rounded-md bg-muted/40 text-xs flex gap-2">
                      <span className="text-muted-foreground tabular-nums shrink-0">#{i + 1}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Bodies ({variations.length} shown{bodyCount > variations.length ? ` of ${bodyCount.toLocaleString()}` : ""})
              </div>
              {variations.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No content to preview.</div>
              ) : (
                <div className="space-y-2">
                  {variations.map((v, i) => (
                    <div key={i} className="p-3 rounded-lg border border-border bg-card">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          Variation #{i + 1}
                        </span>
                      </div>
                      <div className="text-xs whitespace-pre-wrap leading-relaxed">{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
              At send time, each recipient gets a randomly selected variation. Reply
              rates per variation are tracked so the best performers can be reused.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
