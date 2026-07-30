import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Plus, Trash2, ChevronLeft, ChevronRight, Mail, MessageSquare, Linkedin, Instagram, Facebook, Check, Users } from "lucide-react";
import { toast } from "sonner";
import { generateCopy } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { SpinTaxPreview } from "@/components/campaigns/spin-tax-preview";
import { findBlockedMatches, DEFAULT_BLOCKED_KEYWORDS } from "@/lib/blocked-keywords";
import { AlertTriangle, ShieldAlert } from "lucide-react";

type FollowUp = {
  step_number: number;
  delay_days: number;
  channel: string;
  message: string;
  open_aware: boolean;
  message_if_opened: string;
  message_if_not_opened: string;
};

const STEPS = ["Audience", "Channel", "Message", "Follow-ups", "Schedule", "Review"] as const;

const CHANNELS = [
  { v: "email",     l: "Email",     desc: "Full HTML · Track opens & clicks",      Icon: Mail },
  { v: "sms",       l: "SMS",       desc: "160 chars/segment · Delivery tracking", Icon: MessageSquare },
  { v: "linkedin",  l: "LinkedIn",  desc: "300 char limit · 20/day cap",           Icon: Linkedin },
  { v: "instagram", l: "Instagram", desc: "1,000 chars · Business account required", Icon: Instagram },
  { v: "facebook",  l: "Facebook",  desc: "Messenger API · Page required",         Icon: Facebook },
];

const VARS = ["first_name", "last_name", "company", "title", "city"];

export function CampaignWizard({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; onSaved: () => void }) {
  const { team } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const genFn = useServerFn(generateCopy);

  const [contactCount, setContactCount] = useState<number>(0);
  const [audienceFilter, setAudienceFilter] = useState<"all" | "scored" | "stage">("all");
  const [minScore, setMinScore] = useState(70);
  const [stageId, setStageId] = useState<string>("");
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);

  const [name, setName] = useState("");
  const [type, setType] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [aiPersonalize, setAiPersonalize] = useState(true);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);

  const [sendingWindow, setSendingWindow] = useState(false);
  const [days, setDays] = useState<string[]>(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [timezone, setTimezone] = useState("UTC");
  const [cplThreshold, setCplThreshold] = useState<number>(20);
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>(DEFAULT_BLOCKED_KEYWORDS);
  const [overrideKeywords, setOverrideKeywords] = useState(false);



  useEffect(() => {
    if (!open || !team?.id) return;
    setStep(0);
    setOverrideKeywords(false);
    supabase.from("pipeline_stages").select("id, name").eq("team_id", team.id).order("position").then(({ data }) => setStages(data ?? []));
    supabase.from("team_settings").select("blocked_keywords").eq("team_id", team.id).maybeSingle().then(({ data }) => {
      const kws = (data?.blocked_keywords as string[] | null) ?? DEFAULT_BLOCKED_KEYWORDS;
      setBlockedKeywords(kws.length ? kws : DEFAULT_BLOCKED_KEYWORDS);
    });
  }, [open, team?.id]);

  useEffect(() => {
    if (!team?.id) return;
    let q = supabase.from("contacts").select("id", { count: "exact", head: true }).eq("team_id", team.id);
    if (audienceFilter === "scored") q = q.gte("lead_score", minScore);
    q.then(({ count }) => setContactCount(count ?? 0));
  }, [team?.id, audienceFilter, minScore]);

  const aiGenerate = async () => {
    if (!aiPrompt.trim()) return toast.error("Describe your offer first");
    setAiBusy(true);
    try {
      const r = await genFn({ data: { prompt: aiPrompt, channel: type } });
      setBody(r.text);
      if (r.subject) setSubject(r.subject);
      toast.success("AI draft ready");
    } catch (e: any) {
      toast.error(e?.message ?? "AI generation failed");
    } finally { setAiBusy(false); }
  };

  const insertVar = (v: string) => setBody(b => b + ` {{${v}}}`);

  const addFollowUp = () => {
    setFollowUps(f => [...f, {
      step_number: f.length + 1, delay_days: 3, channel: type,
      message: "", open_aware: false, message_if_opened: "", message_if_not_opened: "",
    }]);
  };
  const removeFollowUp = (i: number) => {
    setFollowUps(f => f.filter((_, idx) => idx !== i).map((fu, idx) => ({ ...fu, step_number: idx + 1 })));
  };
  const updateFollowUp = (i: number, patch: Partial<FollowUp>) => {
    setFollowUps(f => f.map((fu, idx) => idx === i ? { ...fu, ...patch } : fu));
  };

  const combinedText = `${subject || ""}\n${body || ""}\n${followUps.map(f => `${f.message} ${f.message_if_opened} ${f.message_if_not_opened}`).join("\n")}`;
  const keywordMatches = useMemo(() => findBlockedMatches(combinedText, blockedKeywords), [combinedText, blockedKeywords]);
  const isSmsLike = type === "sms";
  const keywordHardBlocked = keywordMatches.length > 0 && isSmsLike;
  const keywordWarn = keywordMatches.length > 0 && !isSmsLike;

  const create = async () => {
    if (!team?.id) return;
    if (!name.trim() || !body.trim()) { toast.error("Name and message are required"); setStep(2); return; }
    if (keywordHardBlocked) {
      toast.error(`Cannot send SMS — blocked keywords found: ${keywordMatches.slice(0, 5).join(", ")}${keywordMatches.length > 5 ? "…" : ""}`);
      setStep(2);
      return;
    }
    if (keywordWarn && !overrideKeywords) {
      toast.error(`Email contains blocked keywords (${keywordMatches.length}). Tick "Send anyway" on the Review step or remove them.`);
      setStep(STEPS.length - 1);
      return;
    }
    setBusy(true);
    try {
      const { data: campaign, error } = await supabase.from("campaigns").insert({
        team_id: team.id, name, type: type as any,
        subject: type === "email" ? subject : null,
        body, status: "draft",
        ai_personalization: aiPersonalize,
        sending_window_enabled: sendingWindow,
        sending_days: days,
        sending_start_time: sendingWindow ? startTime : null,
        sending_end_time: sendingWindow ? endTime : null,
        timezone,
        cost_per_lead_threshold: cplThreshold,
      }).select("id").single();
      if (error) throw error;

      if (followUps.length > 0) {
        const { error: fuErr } = await supabase.from("follow_up_sequences").insert(
          followUps.map(fu => ({
            campaign_id: campaign.id, team_id: team.id,
            step_number: fu.step_number, delay_days: fu.delay_days,
            channel: fu.channel as any, message: fu.message, open_aware: fu.open_aware,
            message_if_opened: fu.open_aware ? fu.message_if_opened : null,
            message_if_not_opened: fu.open_aware ? fu.message_if_not_opened : null,
          })),
        );
        if (fuErr) throw fuErr;
      }

      let cq = supabase.from("contacts").select("id").eq("team_id", team.id);
      if (audienceFilter === "scored") cq = cq.gte("lead_score", minScore);
      const { data: contacts } = await cq.limit(5000);
      if (contacts && contacts.length > 0) {
        const rows = contacts.map(c => ({ campaign_id: campaign.id, team_id: team.id, contact_id: c.id, status: "pending" as const }));
        await supabase.from("campaign_contacts").insert(rows);
      }

      toast.success(`Campaign created (${contacts?.length ?? 0} contacts enrolled)`);
      onSaved();
      onOpenChange(false);
      setName(""); setSubject(""); setBody(""); setFollowUps([]); setAiPrompt("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create campaign");
    } finally { setBusy(false); }
  };

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep(s => Math.max(0, s - 1));

  const canAdvance = () => {
    if (step === 1) return !!type;
    if (step === 2) return !!name.trim() && !!body.trim() && (type !== "email" || !!subject.trim());
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "Sora" }}>New Campaign</DialogTitle>
          <Stepper step={step} />
        </DialogHeader>

        <div className="py-2 min-h-[340px]">
          {/* Step 0 — Audience */}
          {step === 0 && (
            <div className="space-y-4">
              <Label>Who should receive this campaign?</Label>
              <Select value={audienceFilter} onValueChange={(v: any) => setAudienceFilter(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All contacts</SelectItem>
                  <SelectItem value="scored">Lead score above threshold</SelectItem>
                  <SelectItem value="stage">In specific pipeline stage</SelectItem>
                </SelectContent>
              </Select>
              {audienceFilter === "scored" && (
                <div>
                  <Label>Minimum lead score</Label>
                  <Input type="number" value={minScore} min={0} max={100} onChange={e => setMinScore(Number(e.target.value))} className="max-w-xs" />
                </div>
              )}
              {audienceFilter === "stage" && (
                <div>
                  <Label>Stage</Label>
                  <Select value={stageId} onValueChange={setStageId}>
                    <SelectTrigger className="max-w-xs"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <Card className="p-6 bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <div className="text-4xl font-bold tabular-nums text-primary" style={{ fontFamily: "Sora" }}>
                      {contactCount.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">contacts will receive this campaign</div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Step 1 — Channel */}
          {step === 1 && (
            <div className="space-y-3">
              <Label>Channel</Label>
              <div className="grid gap-2.5">
                {CHANNELS.map(c => {
                  const on = type === c.v;
                  return (
                    <button
                      key={c.v} type="button" onClick={() => setType(c.v)}
                      className={cn(
                        "relative w-full text-left flex items-center gap-4 p-4 border rounded-xl transition-all active:scale-[0.99]",
                        on ? "border-primary bg-primary/10 shadow-primary-glow" : "border-border hover:border-primary/40",
                      )}
                    >
                      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", on ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                        <c.Icon className="w-7 h-7" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold" style={{ fontFamily: "Sora" }}>{c.l}</div>
                        <div className="text-xs text-muted-foreground">{c.desc}</div>
                      </div>
                      {on && (
                        <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 — Message */}
          {step === 2 && (
            <div className="space-y-4">
              <div><Label>Campaign name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Q1 Outreach" /></div>
              {type === "email" && (
                <div><Label>Subject</Label><Input value={subject} onChange={e => setSubject(e.target.value)} /></div>
              )}
              <div>
                <Label>Message</Label>
                <Textarea rows={7} value={body} onChange={e => setBody(e.target.value)} placeholder="Hi {John|there}, I wanted to reach out about {your project|your company}…" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {VARS.map(v => (
                    <button
                      key={v} type="button" onClick={() => insertVar(v)}
                      className="px-2 py-1 rounded-full text-[10px] font-mono bg-muted hover:bg-primary/15 hover:text-primary transition-colors"
                    >{`{{${v}}}`}</button>
                  ))}
                </div>
                <div className="mt-3">
                  <SpinTaxPreview template={body} subject={type === "email" ? subject : undefined} />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <Switch checked={aiPersonalize} onCheckedChange={setAiPersonalize} />
                <div className="flex-1">
                  <div className="text-sm font-medium">AI personalization</div>
                  <div className="text-xs text-muted-foreground">Generate per-contact variants before launch (review required).</div>
                </div>
              </div>
              <Card className="p-4 bg-gradient-to-br from-primary/10 to-transparent border-primary/30 space-y-3 shadow-primary-glow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: "Sora" }}>
                    <Sparkles className="w-4 h-4 text-primary" />AI Writing Assistant
                  </div>
                  <Badge className="bg-primary/15 text-primary border border-primary/30 text-[10px]">Powered by Claude AI</Badge>
                </div>
                <Input placeholder="Describe your offer…" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} />
                <Button type="button" size="sm" onClick={aiGenerate} disabled={aiBusy}>
                  {aiBusy ? "Generating…" : "Generate copy"}
                </Button>
              </Card>
            </div>
          )}

          {/* Step 3 — Follow-ups */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Follow-up sequence</Label>
                  <p className="text-xs text-muted-foreground">Auto-send if no reply after delay.</p>
                </div>
                <Button size="sm" variant="outline" onClick={addFollowUp}><Plus className="w-3 h-3 mr-1" />Add follow-up</Button>
              </div>
              {followUps.length === 0 && (
                <div className="text-xs text-muted-foreground italic text-center py-6 border border-dashed border-border rounded-lg">No follow-ups configured</div>
              )}
              {followUps.map((fu, i) => (
                <Card key={i} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Step {fu.step_number}</div>
                    <Button size="sm" variant="ghost" onClick={() => removeFollowUp(i)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Delay (days)</Label><Input type="number" value={fu.delay_days} onChange={e => updateFollowUp(i, { delay_days: Number(e.target.value) })} /></div>
                    <div>
                      <Label className="text-xs">Channel</Label>
                      <Select value={fu.channel} onValueChange={v => updateFollowUp(i, { channel: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                          <SelectItem value="linkedin">LinkedIn</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch checked={fu.open_aware} onCheckedChange={(b: boolean) => updateFollowUp(i, { open_aware: b })} />
                    <span className="text-xs text-muted-foreground">Open-aware (branch on open)</span>
                  </div>
                  {fu.open_aware ? (
                    <>
                      <div><Label className="text-xs">Message if opened (no reply)</Label><Textarea rows={2} value={fu.message_if_opened} onChange={e => updateFollowUp(i, { message_if_opened: e.target.value })} /></div>
                      <div><Label className="text-xs">Message if not opened</Label><Textarea rows={2} value={fu.message_if_not_opened} onChange={e => updateFollowUp(i, { message_if_not_opened: e.target.value })} /></div>
                    </>
                  ) : (
                    <div><Label className="text-xs">Message</Label><Textarea rows={2} value={fu.message} onChange={e => updateFollowUp(i, { message: e.target.value })} /></div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Step 4 — Schedule */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <Switch checked={sendingWindow} onCheckedChange={setSendingWindow} />
                <div>
                  <div className="text-sm font-medium">Enforce sending window</div>
                  <div className="text-xs text-muted-foreground">Only send during business hours on selected days.</div>
                </div>
              </div>
              {sendingWindow && (
                <>
                  <div>
                    <Label className="mb-2 block">Days</Label>
                    <div className="flex flex-wrap gap-1">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
                        <button key={d} type="button" onClick={() => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d])}
                          className={cn("px-3 py-1.5 text-xs rounded-lg border transition-colors", days.includes(d) ? "border-primary bg-primary/10 text-primary" : "border-border")}>{d}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label className="text-xs">Start</Label><Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
                    <div><Label className="text-xs">End</Label><Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
                    <div><Label className="text-xs">Timezone</Label><Input value={timezone} onChange={e => setTimezone(e.target.value)} /></div>
                  </div>
                </>
              )}
              <div className="pt-2 border-t border-border/60">
                <Label>Auto-pause: max cost per lead ($)</Label>
                <Input
                  type="number" min={1} step={1}
                  value={cplThreshold}
                  onChange={e => setCplThreshold(Number(e.target.value) || 0)}
                  className="max-w-xs"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Campaign auto-pauses if cost per lead exceeds this, bounce rate &gt; 5%, or 0 replies after 5K sends.
                </p>
              </div>
            </div>
          )}

          {/* Step 5 — Review */}
          {step === 5 && (
            <div className="space-y-4">
              {keywordMatches.length > 0 && (
                <Card className={cn("p-4 border-l-4", keywordHardBlocked ? "border-l-destructive bg-destructive/5" : "border-l-amber-500 bg-amber-500/5")}>
                  <div className="flex items-start gap-3">
                    {keywordHardBlocked ? <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        {keywordHardBlocked ? "SMS blocked — banned keywords detected" : `Email warning — ${keywordMatches.length} banned keyword${keywordMatches.length === 1 ? "" : "s"} detected`}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {keywordMatches.map(k => (
                          <span key={k} className="px-2 py-0.5 rounded-full text-[11px] bg-background border border-border font-mono">{k}</span>
                        ))}
                      </div>
                      {keywordHardBlocked ? (
                        <p className="text-xs text-muted-foreground mt-2">Carriers will block these. Edit your message or remove these words to continue.</p>
                      ) : (
                        <label className="flex items-center gap-2 mt-3 text-xs">
                          <input type="checkbox" checked={overrideKeywords} onChange={e => setOverrideKeywords(e.target.checked)} />
                          Send anyway (logged for compliance review)
                        </label>
                      )}
                    </div>
                  </div>
                </Card>
              )}
              <div className="grid md:grid-cols-2 gap-4">

              <Card className="p-4 space-y-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Summary</div>
                <Row k="Name" v={name || "—"} />
                <Row k="Channel" v={type} />
                <Row k="Audience" v={`${contactCount.toLocaleString()} contacts (${audienceFilter})`} />
                <Row k="Follow-ups" v={`${followUps.length} step${followUps.length === 1 ? "" : "s"}`} />
                <Row k="AI personalization" v={aiPersonalize ? "On" : "Off"} />
                <Row k="Sending window" v={sendingWindow ? `${days.join(", ")} ${startTime}–${endTime} ${timezone}` : "Send anytime"} />
                <p className="text-xs text-muted-foreground pt-3 border-t border-border">
                  Saved as <Badge variant="secondary" className="text-[10px]">draft</Badge>. {aiPersonalize ? 'Use "Personalize & Review" to generate variants, then Launch.' : "Launch from the campaigns list when ready."}
                </p>
              </Card>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Preview</div>
                {type === "email" ? (
                  <div className="rounded-xl border border-border bg-background overflow-hidden shadow-card">
                    <div className="bg-muted/60 px-3 py-2 border-b border-border text-xs">
                      <div><span className="text-muted-foreground">Subject: </span><span className="font-medium">{subject || "—"}</span></div>
                    </div>
                    <div className="p-4 text-sm whitespace-pre-wrap min-h-[160px]">{body || "Your message preview…"}</div>
                  </div>
                ) : (
                  <div className="mx-auto w-[260px] rounded-[28px] border-4 border-foreground/20 bg-background p-3 shadow-card">
                    <div className="text-[10px] text-center text-muted-foreground mb-2">{type.toUpperCase()} preview</div>
                    <div className="bg-primary/10 rounded-2xl rounded-bl-none p-3 text-sm whitespace-pre-wrap min-h-[140px]">
                      {body || "Your message preview…"}
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-3 border-t border-border">
          <Button variant="ghost" onClick={prev} disabled={step === 0}><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={!canAdvance()}>Next<ChevronRight className="w-4 h-4 ml-1" /></Button>
          ) : (
            <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create campaign"}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-start gap-2 pt-3 overflow-x-auto">
      {STEPS.map((s, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <div key={s} className="flex items-start gap-2 flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border transition-all",
                  done && "bg-primary text-primary-foreground border-primary",
                  current && "bg-primary/15 text-primary border-primary shadow-primary-glow",
                  !done && !current && "bg-muted text-muted-foreground border-border",
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <div className={cn("text-[10px] text-center whitespace-nowrap", current ? "text-foreground font-medium" : "text-muted-foreground")}>{s}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("flex-1 h-px mt-3.5", done ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right truncate capitalize">{v}</span>
    </div>
  );
}
