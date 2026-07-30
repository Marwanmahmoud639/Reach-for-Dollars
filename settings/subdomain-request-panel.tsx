import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { requestSubdomain, listMySubdomainRequests } from "@/lib/subdomains.functions";

const DOMAIN_SUFFIX = ".dialingfordollars.co";

export function SubdomainRequestPanel() {
  const list = useServerFn(listMySubdomainRequests);
  const req = useServerFn(requestSubdomain);
  const [slug, setSlug] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [approved, setApproved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    list({ data: undefined as any })
      .then((r: any) => { setRows(r.requests ?? []); setApproved(r.approvedSubdomain ?? null); })
      .catch(() => {});

  useEffect(() => { load(); }, []);

  const submit = async () => {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setBusy(true);
    try {
      await req({ data: { subdomain: s } });
      toast.success("Request submitted. Awaiting super-admin approval.");
      setSlug("");
      load();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const pending = rows.find((r) => r.status === "pending");

  return (
    <Card className="p-6 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Custom subdomain</h3>
      </div>
      {approved ? (
        <div className="text-sm">
          Your branded URL:{" "}
          <a className="text-primary font-mono" href={`https://${approved}${DOMAIN_SUFFIX}`} target="_blank" rel="noreferrer">
            {approved}{DOMAIN_SUFFIX}
          </a>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick a slug and request approval. Once a super admin approves, your sub-account will be reachable at
          <span className="font-mono"> yourname{DOMAIN_SUFFIX}</span>.
        </p>
      )}

      {pending ? (
        <div className="text-sm flex items-center gap-2">
          <Badge variant="secondary">Pending</Badge>
          <span className="font-mono">{pending.subdomain}{DOMAIN_SUFFIX}</span>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Requested subdomain</Label>
            <div className="flex items-center">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="vaname"
                className="rounded-r-none"
              />
              <span className="px-3 h-9 inline-flex items-center text-xs text-muted-foreground border border-l-0 border-input rounded-r-md bg-muted">
                {DOMAIN_SUFFIX}
              </span>
            </div>
          </div>
          <Button onClick={submit} disabled={busy || !slug.trim()}>Request</Button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="border-t border-border pt-3">
          <h4 className="text-xs uppercase text-muted-foreground mb-2">History</h4>
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="font-mono">{r.subdomain}{DOMAIN_SUFFIX}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "approved" ? "default" : r.status === "denied" ? "destructive" : "secondary"} className="capitalize">{r.status}</Badge>
                  {r.status === "denied" && r.denial_reason && (
                    <span className="text-xs text-muted-foreground italic">"{r.denial_reason}"</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
