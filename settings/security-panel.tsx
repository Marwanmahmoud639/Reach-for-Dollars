import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, Trash2, Info } from "lucide-react";
import { toast } from "sonner";

type Factor = { id: string; friendly_name?: string; status: string; factor_type: string };

/**
 * Two-factor authentication via Supabase Auth MFA.
 *
 * TOTP only. Supabase Auth does not implement WebAuthn, so hardware security
 * keys cannot be enrolled here — offering a button that can't work would be
 * worse than saying so. Any TOTP app (1Password, Authy, Google Authenticator)
 * works, including on a phone, which covers most of what a security key would.
 */
export function SecurityPanel() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);

  // Enrolment state — held only until verification completes.
  const [enrolling, setEnrolling] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) toast.error(error.message);
    // Only verified factors actually protect the account; unverified ones are
    // abandoned enrolment attempts.
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.status === "verified"));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const startEnroll = async () => {
    setEnrolling(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
    });
    if (error) {
      toast.error(error.message);
      setEnrolling(false);
      return;
    }
    setFactorId(data.id);
    setQrSvg((data as any).totp?.qr_code ?? null);
    setSecret((data as any).totp?.secret ?? null);
  };

  const cancelEnroll = async () => {
    // Remove the half-finished factor so it can't linger unverified.
    if (factorId) await supabase.auth.mfa.unenroll({ factorId }).catch(() => null);
    setEnrolling(false);
    setFactorId(null);
    setQrSvg(null);
    setSecret(null);
    setCode("");
  };

  const verify = async () => {
    if (!factorId) return;
    setVerifying(true);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr) { toast.error(cErr.message); setVerifying(false); return; }
    const { error } = await supabase.auth.mfa.verify({
      factorId, challengeId: challenge.id, code: code.trim(),
    });
    setVerifying(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Two-factor authentication enabled");
    setEnrolling(false);
    setFactorId(null); setQrSvg(null); setSecret(null); setCode("");
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this authenticator? You'll sign in with just your password until you add another.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return toast.error(error.message);
    toast.success("Removed");
    refresh();
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="w-4 h-4" /> Two-factor authentication
      </div>
      <p className="text-sm text-muted-foreground">
        Adds a second step at sign-in, so a stolen password alone isn't enough to get in.
      </p>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!loading && factors.length > 0 && (
        <div className="space-y-2">
          {factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  {f.friendly_name || "Authenticator app"}
                  <Badge className="text-[10px]">Active</Badge>
                </div>
                <div className="text-xs text-muted-foreground uppercase">{f.factor_type}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(f.id)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {!loading && !enrolling && (
        <Button onClick={startEnroll}>
          {factors.length > 0 ? "Add another authenticator" : "Enable two-factor authentication"}
        </Button>
      )}

      {enrolling && (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="text-sm font-medium">1. Scan this with your authenticator app</div>
          {qrSvg ? (
            <div
              className="bg-white p-3 rounded-lg inline-block [&_svg]:w-44 [&_svg]:h-44"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </div>
          )}

          {secret && (
            <div className="text-xs text-muted-foreground">
              Can't scan? Enter this key manually:
              <code className="ml-1 font-mono bg-muted px-1.5 py-0.5 rounded select-all">{secret}</code>
            </div>
          )}

          <div className="grid gap-1.5 max-w-xs">
            <Label>2. Enter the 6-digit code it shows</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              className="font-mono tracking-widest"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={verify} disabled={code.length !== 6 || verifying}>
              {verifying ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Verifying…</> : "Verify and enable"}
            </Button>
            <Button variant="ghost" onClick={cancelEnroll}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Hardware security keys (YubiKey, passkeys) aren't available here — Supabase Auth
          implements TOTP but not WebAuthn, so there's no way to register one. Any authenticator
          app works, including the one built into 1Password or your phone's keychain.
        </p>
      </div>
    </Card>
  );
}
