import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Send, ShieldCheck, AlertTriangle } from "lucide-react";
import { generateLeadDraft, validatePhone } from "@/lib/lead-tools.functions";
import { sendReply } from "@/lib/inbox.functions";
import { findBlockedMatches, DEFAULT_BLOCKED_KEYWORDS } from "@/lib/blocked-keywords";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui/checkbox";

type ComposeProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  initialChannel?: "email" | "sms";
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSent?: () => void;
};

export function LeadComposeDialog({
  open, onOpenChange, contactId,
  initialChannel = "email", contactEmail, contactPhone, onSent,
}: ComposeProps) {
  const { role } = useAuth();
  const canOverride = role === "admin" || role === "manager";
  const [channel, setChannel] = useState<"email" | "sms">(initialChannel);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [overrideKw, setOverrideKw] = useState(false);

  const draftFn = useServerFn(generateLeadDraft);
  const sendFn = useServerFn(sendReply);

  const targetAddress = channel === "email" ? contactEmail : contactPhone;
  const blockedMatches = findBlockedMatches(`${subject}\n${body}`, DEFAULT_BLOCKED_KEYWORDS);
  const hasBlocked = blockedMatches.length > 0;

  const handleGenerate = async () => {
    setDrafting(true);
    try {
      const { draft } = await draftFn({ data: { contactId, channel, instruction: instruction || undefined } });
      if (!draft) throw new Error("Empty draft");
      setBody(draft);
      toast.success("AI draft ready — review and edit before sending");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate draft");
    } finally {
      setDrafting(false);
    }
  };

  const handleSend = async () => {
    if (!body.trim()) return toast.error("Message body is empty");
    if (!targetAddress) return toast.error(`No ${channel === "email" ? "email" : "phone"} on file`);
    if (hasBlocked) {
      if (channel === "sms") {
        return toast.error(`Cannot send — restricted terms: ${blockedMatches.join(", ")}`);
      }
      if (!overrideKw) {
        return toast.error("Restricted terms detected — confirm override to send.");
      }
      if (!canOverride) {
        return toast.error("Only admins or managers can override blocked-keyword warnings.");
      }
    }
    setSending(true);
    try {
      await sendFn({
        data: {
          contactId, channel, body: body.trim(),
          subject: channel === "email" ? (subject.trim() || undefined) : undefined,
          overrideKeywords: hasBlocked && overrideKw ? true : undefined,
        },
      });
      toast.success(`${channel === "email" ? "Email" : "SMS"} sent`);
      onOpenChange(false);
      setBody(""); setSubject(""); setInstruction(""); setOverrideKw(false);
      onSent?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send message</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email" disabled={!contactEmail}>Email{!contactEmail ? " (no address)" : ""}</SelectItem>
                  <SelectItem value="sms" disabled={!contactPhone}>SMS{!contactPhone ? " (no phone)" : ""}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input value={targetAddress ?? ""} disabled className="font-mono text-xs" />
            </div>
          </div>

          {channel === "email" && (
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick intro" />
            </div>
          )}

          <div>
            <Label className="text-xs">AI instruction (optional)</Label>
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. ask about their referral program"
              disabled={drafting}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Message</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleGenerate} disabled={drafting}>
                {drafting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                Generate with AI
              </Button>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={channel === "sms" ? "Short SMS (≤160 chars)..." : "Your message..."}
              rows={channel === "sms" ? 4 : 8}
            />
            {channel === "sms" && (
              <p className={`text-[10px] mt-1 ${body.length > 160 ? "text-destructive" : "text-muted-foreground"}`}>
                {body.length}/160 chars
              </p>
            )}
          </div>

          {hasBlocked && (
            <div className={`rounded-md p-2.5 border text-xs space-y-1.5 ${
              channel === "sms"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}>
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                {channel === "sms" ? "Cannot send — restricted terms" : "Warning — restricted terms"}
              </div>
              <div className="flex flex-wrap gap-1">
                {blockedMatches.map((m) => (
                  <Badge key={m} variant="outline" className="rounded-full text-[10px]">{m}</Badge>
                ))}
              </div>
              {channel === "email" && canOverride && (
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <Checkbox checked={overrideKw} onCheckedChange={(v) => setOverrideKw(!!v)} />
                  <span>Send anyway (override will be logged)</span>
                </label>
              )}
              {channel === "email" && !canOverride && (
                <p className="pt-1 opacity-80">Only admins or managers can override.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={
              sending || !body.trim() || !targetAddress ||
              (hasBlocked && channel === "sms") ||
              (hasBlocked && channel === "email" && (!overrideKw || !canOverride))
            }
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ValidateProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  phones: { phone_number: string }[];
};

type ValidateResult = {
  phone: string;
  is_valid: boolean;
  line_type: string | null;
  carrier: string | null;
  country_code: string | null;
  country_name: string | null;
  country_calling_code: string | null;
  is_prepaid: boolean | null;
  is_commercial: boolean | null;
};

export function LeadValidatePhoneDialog({ open, onOpenChange, contactId, phones }: ValidateProps) {
  const [results, setResults] = useState<Record<string, ValidateResult>>({});
  const [loadingPhone, setLoadingPhone] = useState<string | null>(null);
  const validateFn = useServerFn(validatePhone);

  const list = phones.length ? phones : [];

  const run = async (phone: string) => {
    setLoadingPhone(phone);
    try {
      const { result } = await validateFn({ data: { phone, contactId } });
      setResults((r) => ({ ...r, [phone]: result }));
    } catch (e: any) {
      toast.error(e?.message ?? "Validation failed");
    } finally {
      setLoadingPhone(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Validate number</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Returns carrier, line type, country and validity from Trestle. Does not return the phone owner's name —
            free APIs do not provide reliable ownership data.
          </p>
        </DialogHeader>
        <div className="space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">No phone numbers on file for this contact.</p>
          )}
          {list.map((p) => {
            const r = results[p.phone_number];
            return (
              <div key={p.phone_number} className="border border-border rounded-md p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">{p.phone_number}</span>
                  <Button size="sm" variant="outline" onClick={() => run(p.phone_number)} disabled={loadingPhone === p.phone_number}>
                    {loadingPhone === p.phone_number
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : r ? "Re-check" : "Validate"}
                  </Button>
                </div>
                {r && (
                  <div className="text-xs space-y-1">
                    <div className="flex items-center gap-1.5">
                      {r.is_valid
                        ? <Badge variant="outline" className="rounded-full text-[10px]"><ShieldCheck className="w-3 h-3 mr-1 text-green-600" /> Valid</Badge>
                        : <Badge variant="destructive" className="rounded-full text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" /> Invalid</Badge>}
                      {r.line_type && <Badge variant="secondary" className="rounded-full text-[10px]">{r.line_type}</Badge>}
                      {r.is_prepaid && <Badge variant="secondary" className="rounded-full text-[10px]">Prepaid</Badge>}
                      {r.is_commercial && <Badge variant="secondary" className="rounded-full text-[10px]">Commercial</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                      {r.carrier && <div><span className="text-foreground">Carrier:</span> {r.carrier}</div>}
                      {r.country_name && <div><span className="text-foreground">Country:</span> {r.country_name}{r.country_code ? ` (${r.country_code})` : ""}</div>}
                      {r.country_calling_code && <div><span className="text-foreground">Code:</span> +{r.country_calling_code}</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SocialProps = {
  linkedin_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  twitter_url?: string | null;
  youtube_url?: string | null;
};

export function LeadSocialLinks(s: SocialProps) {
  const items = [
    { key: "LinkedIn", url: s.linkedin_url },
    { key: "Instagram", url: s.instagram_url },
    { key: "Facebook", url: s.facebook_url },
    { key: "Twitter", url: s.twitter_url },
    { key: "YouTube", url: s.youtube_url },
  ].filter((i) => i.url);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <a
          key={i.key}
          href={i.url!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center"
        >
          <Badge variant="outline" className="rounded-full text-[10px] hover:bg-accent cursor-pointer">
            {i.key}
          </Badge>
        </a>
      ))}
    </div>
  );
}
