import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BOOKING_URL } from "@/lib/brand";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCalling } from "@/components/calling/calling-provider";
import { useLeadDrawer } from "./lead-drawer-provider";
import { ContactNotes } from "./contact-notes";
import { CallHistoryList } from "./call-history-list";
import { ContactTasks } from "./contact-tasks";
import { LeadComposeDialog, LeadValidatePhoneDialog, LeadSocialLinks } from "./lead-quick-tools";
import { retryDMSearch } from "@/lib/lead-tools.functions";
import {
  Mail, Phone, Calendar, ExternalLink, PhoneCall, MessageSquare, Send,
  CalendarPlus, Pencil, ShieldAlert, UserPlus, Bot, MessageCircle, ShieldCheck,
  Building2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type Stage = { id: string; name: string; color: string };

export function LeadDrawer() {
  const { open, contactId, closeLead } = useLeadDrawer();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeLead()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-xl overflow-y-auto p-0">
        {contactId ? <LeadDrawerBody contactId={contactId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function LeadDrawerBody({ contactId }: { contactId: string }) {
  const { team } = useAuth();
  const { startCall } = useCalling();
  const [contact, setContact] = useState<any>(null);
  const [phones, setPhones] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState<"email" | "sms">("email");
  const [validateOpen, setValidateOpen] = useState(false);

  const load = async () => {
    if (!team?.id) return;
    const { data: c } = await supabase.from("contacts").select("*").eq("id", contactId).eq("team_id", team.id).maybeSingle();
    setContact(c);
    const [{ data: p }, { data: m }, { data: lead }] = await Promise.all([
      supabase.from("contact_phones").select("*").eq("contact_id", contactId).order("confidence_score", { ascending: false }),
      supabase.from("messages").select("*").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(20),
      supabase.from("pipeline_leads").select("stage_id").eq("contact_id", contactId).eq("team_id", team.id).maybeSingle(),
    ]);
    setPhones(p ?? []);
    setMessages(m ?? []);
    if (lead?.stage_id) {
      const { data: s } = await supabase.from("pipeline_stages").select("id,name,color").eq("id", lead.stage_id).maybeSingle();
      setStage((s as Stage | null) ?? null);
    } else {
      setStage(null);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [contactId, team?.id]);

  if (!contact) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const primaryPhone = contact.phone || phones[0]?.phone_number;
  const created = contact.created_at ? new Date(contact.created_at).toLocaleDateString() : null;

  const callNow = () => primaryPhone ? startCall(primaryPhone, contactId) : toast.error("No phone on file");
  const openCompose = (ch: "email" | "sms") => {
    if (ch === "email" && !contact.email) return toast.error("No email on file");
    if (ch === "sms" && !primaryPhone) return toast.error("No phone on file");
    setComposeChannel(ch); setComposeOpen(true);
  };
  const openValidate = () => {
    if (!primaryPhone && phones.length === 0) return toast.error("No phone on file");
    setValidateOpen(true);
  };
  const bookMeeting = () => {
    const params = new URLSearchParams();
    if (contact.name) params.set("name", contact.name);
    if (contact.email) params.set("email", contact.email);
    const url = `${BOOKING_URL}${params.toString() ? `?${params.toString()}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const aiCall = () => toast.info("AI Call coming soon");
  const markDnc = async () => {
    if (!confirm(contact.do_not_contact ? "Remove from DNC?" : "Mark this lead as Do Not Contact?")) return;
    const { error } = await supabase.from("contacts").update({
      do_not_contact: !contact.do_not_contact,
      dnc_added_at: !contact.do_not_contact ? new Date().toISOString() : null,
      dnc_reason: !contact.do_not_contact ? "Marked from lead drawer" : null,
    }).eq("id", contactId);
    if (error) return toast.error(error.message);
    toast.success(contact.do_not_contact ? "Removed from DNC" : "Marked DNC");
    load();
  };

  const retryDM = useServerFn(retryDMSearch);
  const [retrying, setRetrying] = useState(false);
  const onRetryDM = async () => {
    setRetrying(true);
    try {
      const r: any = await retryDM({ data: { contactId } });
      if (r?.found) toast.success(r.message || "Decision maker found");
      else toast.info(r?.message || "No decision maker found yet");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Retry failed");
    } finally { setRetrying(false); }
  };

  return (
    <div className="flex flex-col">
      <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-lg font-semibold truncate">{contact.name || "Untitled contact"}</SheetTitle>
          {contact.business_only && (
            <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/40 gap-1">
              <Building2 className="w-3 h-3" /> B2B
            </Badge>
          )}
        </div>
        {(contact.title || contact.company) && (
          <p className="text-xs text-muted-foreground">{[contact.title, contact.company].filter(Boolean).join(" · ")}</p>
        )}
        {contact.business_only && (
          <div className="mt-2 rounded-md border border-orange-500/30 bg-orange-500/5 p-2 text-xs flex items-center justify-between gap-2">
            <span className="text-orange-700 dark:text-orange-400">
              No decision maker found yet · attempts: {contact.dm_search_attempts || 1}
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1" disabled={retrying} onClick={onRetryDM}>
              <RefreshCw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? "Searching…" : "Retry DM search"}
            </Button>
          </div>
        )}
        <Link
          to="/contacts/$id"
          params={{ id: contactId }}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1 w-fit"
        >
          <ExternalLink className="w-3 h-3" /> Open full profile
        </Link>
      </SheetHeader>

      <div className="p-5 space-y-4">
        {/* Contact info */}
        <section>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase mb-2">Contact info</h4>
          <div className="space-y-1.5 text-sm">
            {contact.email && (
              <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-muted-foreground" /><span className="truncate">{contact.email}</span></div>
            )}
            {primaryPhone && (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <button onClick={callNow} className="text-primary hover:underline font-mono">{primaryPhone}</button>
              </div>
            )}
            {created && (
              <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-muted-foreground" /><span>{created}</span></div>
            )}
            <div className="pt-1">
              <LeadSocialLinks
                linkedin_url={contact.linkedin_url}
                instagram_url={contact.instagram_url}
                facebook_url={contact.facebook_url}
                twitter_url={contact.twitter_url}
                youtube_url={contact.youtube_url}
              />
            </div>
          </div>
        </section>

        {/* Stage */}
        <section>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase mb-2">Stage</h4>
          <div className="flex items-center gap-2">
            {stage ? (
              <Badge variant="outline" className="rounded-full" style={{ borderColor: stage.color || undefined }}>
                {stage.name}
              </Badge>
            ) : (
              <Badge variant="secondary" className="rounded-full">Not in pipeline</Badge>
            )}
            <Badge variant="outline" className="rounded-full text-[10px] inline-flex items-center gap-1">
              <Pencil className="w-2.5 h-2.5" /> {contact.source || "manual"}
            </Badge>
            {contact.do_not_contact && <Badge variant="destructive" className="rounded-full">DNC</Badge>}
          </div>
        </section>

        {/* Notes */}
        <section>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase mb-2">Notes</h4>
          <ContactNotes contactId={contactId} />
        </section>

        {/* Communication timeline */}
        <section>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase mb-2">Communication timeline</h4>
          <Card className="p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                <MessageCircle className="w-6 h-6" />
                <p className="text-xs">No communications recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className="text-xs border-b border-border last:border-0 pb-1.5">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{m.channel}</Badge>
                      <span>{m.direction}</span>
                      <span>· {new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    {m.subject && <div className="font-medium mt-1">{m.subject}</div>}
                    <div className="text-foreground/90 whitespace-pre-wrap line-clamp-3">{m.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* Actions */}
        <section>
          <h4 className="text-[11px] tracking-wider text-muted-foreground uppercase mb-2">Actions</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={aiCall}><Bot className="w-3.5 h-3.5 mr-1" /> AI Call</Button>
            <Button size="sm" onClick={callNow} className="bg-amber-500 hover:bg-amber-600 text-amber-950"><PhoneCall className="w-3.5 h-3.5 mr-1" /> Call Now</Button>
            <Button variant="outline" size="sm" onClick={() => openCompose("sms")}><MessageSquare className="w-3.5 h-3.5 mr-1" /> Send SMS</Button>
            <Button variant="outline" size="sm" onClick={() => openCompose("email")}><Send className="w-3.5 h-3.5 mr-1" /> Send Email</Button>
            <Button variant="outline" size="sm" onClick={openValidate}><ShieldCheck className="w-3.5 h-3.5 mr-1" /> Validate Number</Button>
            <Button variant="outline" size="sm" onClick={bookMeeting}><CalendarPlus className="w-3.5 h-3.5 mr-1" /> Book Meeting</Button>
            <Link to="/contacts/$id" params={{ id: contactId }} className="contents">
              <Button variant="outline" size="sm" className="w-full"><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={markDnc} className="text-destructive hover:text-destructive">
              <ShieldAlert className="w-3.5 h-3.5 mr-1" /> {contact.do_not_contact ? "Unmark DNC" : "Mark DNC"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => toast.info("Use Tasks below to assign work")}>
              <UserPlus className="w-3.5 h-3.5 mr-1" /> Assign Rep
            </Button>
          </div>
        </section>

        {/* Tasks */}
        <section>
          <ContactTasks contactId={contactId} />
        </section>

        {/* Call history */}
        <section>
          <CallHistoryList contactId={contactId} />
        </section>
      </div>

      <LeadComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        contactId={contactId}
        initialChannel={composeChannel}
        contactEmail={contact.email}
        contactPhone={primaryPhone}
        onSent={load}
      />
      <LeadValidatePhoneDialog
        open={validateOpen}
        onOpenChange={setValidateOpen}
        contactId={contactId}
        phones={
          phones.length
            ? phones
            : primaryPhone
              ? [{ phone_number: primaryPhone }]
              : []
        }
      />
    </div>
  );
}
