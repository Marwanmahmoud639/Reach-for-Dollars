import { SocialIcons } from "@/components/contacts/social-icons";
import { CheckCircle2, AlertTriangle, MapPin } from "lucide-react";
import { useLeadDrawer } from "@/components/contacts/lead-drawer-provider";

export type MapContact = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  lead_score: number;
  source: string;
  status?: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  created_at: string;
  business_only?: boolean;
};

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function scoreColor(score: number) {
  if (score >= 70) return "bg-[#84cc16]";
  if (score >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

export function LeadPinCard({
  contact,
  onMouseEnter,
  onMouseLeave,
}: {
  contact: MapContact;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { openLead } = useLeadDrawer();
  const isBusiness = !!contact.company;

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto w-80 max-h-[450px] overflow-auto rounded-xl border border-border bg-card shadow-2xl shadow-black/40 text-sm animate-in fade-in duration-150"
    >
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-base leading-tight">
              {isBusiness ? `🏢 ${contact.company}` : `👤 ${contact.name}`}
            </div>
            {contact.business_only && (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500 border border-orange-500/40">
                B2B
              </span>
            )}
          </div>
          {(contact.city || contact.state) && (
            <div className="text-muted-foreground text-xs flex items-center gap-1 mt-0.5">
              <MapPin size={12} />
              {[contact.city, contact.state].filter(Boolean).join(", ")}
            </div>
          )}
        </div>

        {isBusiness && contact.name && (
          <div className="border-t border-border pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Decision Maker</div>
            <div className="font-medium">{contact.name}</div>
            {contact.title && <div className="text-xs text-muted-foreground">{contact.title}</div>}
          </div>
        )}

        {(contact.email || contact.phone) && (
          <div className="border-t border-border pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Contact</div>
            {contact.email && (
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1">📧 {contact.email}</span>
                {contact.email_verified
                  ? <CheckCircle2 size={14} className="text-[#84cc16] shrink-0" />
                  : <AlertTriangle size={14} className="text-yellow-500 shrink-0" />}
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-2 text-xs mt-1">
                <span className="truncate flex-1">☎️ {contact.phone}</span>
                {contact.phone_verified
                  ? <CheckCircle2 size={14} className="text-[#84cc16] shrink-0" />
                  : <AlertTriangle size={14} className="text-yellow-500 shrink-0" />}
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border pt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Social</div>
          <SocialIcons contact={contact} size="sm" />
        </div>

        <div className="border-t border-border pt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-12">Score</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${scoreColor(contact.lead_score)}`} style={{ width: `${Math.min(100, contact.lead_score)}%` }} />
            </div>
            <span className="tabular-nums font-medium">{contact.lead_score}/100</span>
          </div>
          <div className="text-xs text-muted-foreground">Source: {contact.source}</div>
          <div className="text-xs text-muted-foreground">Found: {relTime(contact.created_at)}</div>
        </div>

        <button
          onClick={() => openLead(contact.id)}
          className="w-full rounded-md bg-[#84cc16] hover:bg-[#84cc16]/90 text-black font-semibold py-2 text-sm transition-colors"
        >
          Open in CRM
        </button>
      </div>
    </div>
  );
}
