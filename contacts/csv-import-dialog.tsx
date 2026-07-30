import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import { createImportJob, importContactsBatch, finalizeImportJob } from "@/lib/csv-import.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const TARGET_FIELDS = [
  { key: "", label: "— skip this column —" },
  { key: "name", label: "Name (required)" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "website", label: "Website" },
  { key: "deal_value", label: "Deal value" },
  { key: "priority", label: "Priority" },
  { key: "tags", label: "Tags (comma-sep)" },
  { key: "custom_field_1", label: "Custom 1" },
  { key: "custom_field_2", label: "Custom 2" },
  { key: "custom_field_3", label: "Custom 3" },
] as const;

const MAX_ROWS = 50_000;
const MAX_BYTES = 10 * 1024 * 1024;
const BATCH = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function autoMap(header: string): string {
  const h = header.toLowerCase().trim().replace(/[_\s-]+/g, " ");
  if (["name", "full name", "fullname", "contact", "contact name"].includes(h)) return "name";
  if (["first name", "firstname"].includes(h)) return "name";
  if (["email", "e mail", "email address"].includes(h)) return "email";
  if (["phone", "phone number", "mobile", "cell", "telephone"].includes(h)) return "phone";
  if (["company", "organization", "org", "business"].includes(h)) return "company";
  if (["title", "job title", "role", "position"].includes(h)) return "title";
  if (h.includes("linkedin")) return "linkedin_url";
  if (h === "city") return "city";
  if (h === "state" || h === "region" || h === "province") return "state";
  if (h === "country") return "country";
  if (h === "website" || h === "site" || h === "url") return "website";
  if (h.includes("deal") || h === "value" || h === "amount") return "deal_value";
  if (h === "priority") return "priority";
  if (h === "tags") return "tags";
  return "";
}

type Step = "upload" | "map" | "importing" | "done";
type RowError = { row: number; reason: string };

export function CsvImportDialog({ open, onOpenChange, onComplete }: { open: boolean; onOpenChange: (b: boolean) => void; onComplete?: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number; jobId: string } | null>(null);

  const create = useServerFn(createImportJob);
  const batch = useServerFn(importContactsBatch);
  const finalize = useServerFn(finalizeImportJob);

  const reset = () => {
    setStep("upload"); setFileName(""); setHeaders([]); setPreview([]); setRows([]); setMapping({}); setProgress(0); setProgressText(""); setResult(null);
  };

  const handleFile = useCallback((file: File) => {
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") { toast.error("Please choose a .csv file"); return; }
    if (file.size > MAX_BYTES) { toast.error("File too large (max 10 MB)"); return; }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data;
        if (!data.length) { toast.error("Empty CSV"); return; }
        if (data.length > MAX_ROWS) { toast.error(`Too many rows (max ${MAX_ROWS.toLocaleString()})`); return; }
        const hdrs = res.meta.fields ?? [];
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(data);
        setPreview(data.slice(0, 5));
        const m: Record<string, string> = {};
        hdrs.forEach(h => { m[h] = autoMap(h); });
        setMapping(m);
        setStep("map");
      },
      error: (e) => toast.error(e.message),
    });
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const hasName = useMemo(() => Object.values(mapping).includes("name"), [mapping]);

  // Client-side pre-validation so the user sees issues before import runs.
  const validation = useMemo(() => {
    if (step !== "map") return { errors: [] as RowError[], validCount: 0 };
    const invHeaderByTarget: Record<string, string> = {};
    for (const h of headers) {
      const t = mapping[h];
      if (t) invHeaderByTarget[t] = h;
    }
    const nameH = invHeaderByTarget["name"];
    const emailH = invHeaderByTarget["email"];
    const phoneH = invHeaderByTarget["phone"];
    if (!nameH) return { errors: [], validCount: 0 };
    const errs: RowError[] = [];
    let ok = 0;
    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const name = (r[nameH] ?? "").toString().trim();
      const email = emailH ? (r[emailH] ?? "").toString().trim() : "";
      const phone = phoneH ? (r[phoneH] ?? "").toString().trim() : "";
      const phoneDigits = phone.replace(/\D/g, "");
      if (!name) { errs.push({ row: rowNum, reason: "Name is required" }); return; }
      if (email && !EMAIL_RE.test(email)) { errs.push({ row: rowNum, reason: `Invalid email "${email}"` }); return; }
      if (phone && (phoneDigits.length < 10 || phoneDigits.length > 15)) { errs.push({ row: rowNum, reason: `Phone "${phone}" must be 10–15 digits` }); return; }
      if (!email && !phone) { errs.push({ row: rowNum, reason: "Must have email or phone" }); return; }
      ok++;
    });
    return { errors: errs, validCount: ok };
  }, [step, rows, headers, mapping]);

  const runImport = async () => {
    if (!hasName) { toast.error("Map a column to Name first"); return; }
    if (validation.validCount === 0) { toast.error("No valid rows to import"); return; }
    setStep("importing"); setProgress(0); setProgressText("");
    try {
      const { jobId } = await create({ data: { fileName, totalRows: rows.length } });
      const mapped = rows.map(r => {
        const out: Record<string, string> = {};
        for (const h of headers) {
          const target = mapping[h];
          if (!target) continue;
          out[target] = (r[h] ?? "").toString();
        }
        return out;
      });
      let imported = 0, skipped = 0;
      for (let i = 0; i < mapped.length; i += BATCH) {
        const chunk = mapped.slice(i, i + BATCH);
        const res = await batch({ data: { jobId, rows: chunk, startIndex: i } });
        imported += res.imported; skipped += res.skipped;
        const done = i + chunk.length;
        setProgress(Math.round((done / mapped.length) * 100));
        setProgressText(`${done.toLocaleString()} / ${mapped.length.toLocaleString()}`);
      }
      await finalize({ data: { jobId } });
      setResult({ imported, skipped, jobId });
      setStep("done");
      toast.success(`Imported ${imported.toLocaleString()} contacts`);
      onComplete?.();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
      setStep("map");
    }
  };

  const downloadErrorReport = async () => {
    if (!result) return;
    const { data: job } = await supabase.from("csv_import_jobs").select("error_rows").eq("id", result.jobId).single();
    const errs = Array.isArray(job?.error_rows) ? (job!.error_rows as any[]) : [];
    const csv = Papa.unparse(errs.map((e: any) => ({
      row: e.row, reason: (e.errors || []).join("; "), name: e.data?.name ?? "", email: e.data?.email ?? "", phone: e.data?.phone ?? "",
    })));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${fileName}-errors.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(b) => { onOpenChange(b); if (!b) reset(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Import contacts from CSV</DialogTitle></DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                "border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer transition",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
              )}
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <div className="text-sm font-medium">Drag &amp; drop a CSV here, or click to browse</div>
              <div className="text-xs text-muted-foreground">.csv only · Max 50,000 rows · 10 MB</div>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4" /> <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">· {rows.length.toLocaleString()} rows</span>
            </div>

            <div className="border rounded-lg max-h-72 overflow-auto">
              <table className="text-xs w-full">
                <thead className="bg-muted sticky top-0">
                  <tr>{headers.map(h => (
                    <th key={h} className="text-left p-2 font-medium align-top min-w-[160px]">
                      <div className="mb-1 truncate" title={h}>{h}</div>
                      <Select value={mapping[h] ?? ""} onValueChange={v => setMapping(m => ({ ...m, [h]: v === "_none" ? "" : v }))}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELDS.map(f => <SelectItem key={f.key || "_none"} value={f.key || "_none"}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t">
                      {headers.map(h => <td key={h} className="p-2 text-muted-foreground truncate max-w-[200px]" title={r[h]}>{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!hasName && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Map a column to Name to continue.
              </div>
            )}

            {hasName && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm">
                  Import will add <span className="font-semibold text-foreground">{validation.validCount.toLocaleString()}</span> contacts.{" "}
                  {validation.errors.length > 0 ? (
                    <span className="text-amber-500">
                      {validation.errors.length.toLocaleString()} row{validation.errors.length === 1 ? "" : "s"} ha{validation.errors.length === 1 ? "s" : "ve"} errors and will be skipped.
                    </span>
                  ) : (
                    <span className="text-emerald-500">No validation errors.</span>
                  )}
                </div>
                {validation.errors.length > 0 && (
                  <div className="max-h-32 overflow-auto text-xs font-mono space-y-0.5 bg-muted/40 rounded p-2">
                    {validation.errors.slice(0, 50).map((e, i) => (
                      <div key={i} className="text-muted-foreground"><span className="text-destructive">Row {e.row}:</span> {e.reason}</div>
                    ))}
                    {validation.errors.length > 50 && (
                      <div className="text-muted-foreground italic">…and {(validation.errors.length - 50).toLocaleString()} more</div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>Back</Button>
              <Button onClick={runImport} disabled={!hasName || validation.validCount === 0}>
                Import {validation.validCount.toLocaleString()} Contact{validation.validCount === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-4 py-6">
            <div className="text-sm">Importing… {progressText}</div>
            <Progress value={progress} />
            <div className="text-xs text-muted-foreground text-center">{progress}%</div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-success"><CheckCircle2 className="w-5 h-5" /> Import complete</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Imported</div><div className="text-2xl font-semibold">{result.imported.toLocaleString()}</div></div>
              <div className="rounded-lg border p-3"><div className="text-muted-foreground text-xs">Skipped</div><div className="text-2xl font-semibold">{result.skipped.toLocaleString()}</div></div>
            </div>
            <div className="flex justify-end gap-2">
              {result.skipped > 0 && (
                <Button variant="outline" onClick={downloadErrorReport}><Download className="w-4 h-4 mr-1" /> Error report</Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
