import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ContactLike = {
  city?: string | null;
  state?: string | null;
  lead_score: number;
  source: string;
  email?: string | null;
  phone?: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  linkedin_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  tags?: string[] | null;
  industry?: string | null;
  company?: string | null;
};

export type ContactFilterState = {
  locations: string[];           // "City, ST"
  scoreTiers: ("hot" | "warm" | "cold")[];
  sources: string[];
  emailVerified: "any" | "yes" | "no";
  phoneVerified: "any" | "yes" | "no";
  socials: ("linkedin" | "instagram" | "facebook")[];
  tags: string[];
  industries: string[];
  company: string;
};

export const EMPTY_FILTER: ContactFilterState = {
  locations: [], scoreTiers: [], sources: [],
  emailVerified: "any", phoneVerified: "any",
  socials: [], tags: [], industries: [], company: "",
};

export function filterCountActive(f: ContactFilterState): number {
  return (
    f.locations.length + f.scoreTiers.length + f.sources.length +
    (f.emailVerified !== "any" ? 1 : 0) +
    (f.phoneVerified !== "any" ? 1 : 0) +
    f.socials.length + f.tags.length + f.industries.length +
    (f.company.trim() ? 1 : 0)
  );
}

function locKey(c: ContactLike) {
  const city = (c.city ?? "").trim();
  const state = (c.state ?? "").trim();
  if (!city && !state) return "";
  return state ? `${city}, ${state}` : city;
}

export function applyContactFilter<T extends ContactLike>(items: T[], f: ContactFilterState): T[] {
  return items.filter((c) => {
    if (f.locations.length) {
      const k = locKey(c);
      if (!k || !f.locations.includes(k)) return false;
    }
    if (f.scoreTiers.length) {
      const tier = c.lead_score >= 70 ? "hot" : c.lead_score >= 40 ? "warm" : "cold";
      if (!f.scoreTiers.includes(tier)) return false;
    }
    if (f.sources.length && !f.sources.includes(c.source)) return false;
    if (f.emailVerified === "yes" && !c.email_verified) return false;
    if (f.emailVerified === "no" && c.email_verified) return false;
    if (f.phoneVerified === "yes" && !c.phone_verified) return false;
    if (f.phoneVerified === "no" && c.phone_verified) return false;
    if (f.socials.length) {
      const has = f.socials.some((s) =>
        s === "linkedin" ? !!c.linkedin_url :
        s === "instagram" ? !!c.instagram_url :
        !!c.facebook_url
      );
      if (!has) return false;
    }
    if (f.tags.length) {
      const t = c.tags ?? [];
      if (!f.tags.some((tag) => t.includes(tag))) return false;
    }
    if (f.industries.length && (!c.industry || !f.industries.includes(c.industry))) return false;
    if (f.company.trim() && !(c.company ?? "").toLowerCase().includes(f.company.trim().toLowerCase())) return false;
    return true;
  });
}

function distinct<T>(arr: (T | null | undefined)[]): T[] {
  return Array.from(new Set(arr.filter((v): v is T => v != null && v !== ""))).sort() as T[];
}

export function ContactsFilter({
  contacts,
  value,
  onChange,
}: {
  contacts: ContactLike[];
  value: ContactFilterState;
  onChange: (next: ContactFilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const locations = useMemo(() => distinct(contacts.map(locKey)).filter(Boolean), [contacts]);
  const sources = useMemo(() => distinct(contacts.map((c) => c.source)), [contacts]);
  const tags = useMemo(() => distinct(contacts.flatMap((c) => c.tags ?? [])), [contacts]);
  const industries = useMemo(() => distinct(contacts.map((c) => c.industry ?? null)), [contacts]);

  const count = filterCountActive(value);

  const toggleArr = <K extends keyof ContactFilterState>(key: K, item: string) => {
    const cur = value[key] as unknown as string[];
    const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
    onChange({ ...value, [key]: next as any });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 gap-2">
          <Filter className="w-4 h-4" />
          Filter
          {count > 0 && (
            <Badge className="ml-1 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px]">{count}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-h-[70vh] overflow-y-auto" align="start">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Filter contacts</div>
          {count > 0 && (
            <button onClick={() => onChange(EMPTY_FILTER)} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          )}
        </div>

        <div className="space-y-4">
          <Section label="Location (City, State)">
            {locations.length === 0 ? <Empty>No locations on contacts yet</Empty> : (
              <ChipsGrid items={locations} active={value.locations} onToggle={(v) => toggleArr("locations", v)} />
            )}
          </Section>

          <Section label="Lead score">
            <div className="flex gap-1.5">
              {(["hot","warm","cold"] as const).map((tier) => {
                const on = value.scoreTiers.includes(tier);
                const labels = { hot: "Hot ≥70", warm: "Warm 40–69", cold: "Cold <40" };
                return (
                  <Chip key={tier} active={on} onClick={() => toggleArr("scoreTiers", tier)}>{labels[tier]}</Chip>
                );
              })}
            </div>
          </Section>

          <Section label="Source">
            {sources.length === 0 ? <Empty>—</Empty> : (
              <ChipsGrid items={sources} active={value.sources} onToggle={(v) => toggleArr("sources", v)} />
            )}
          </Section>

          <div className="grid grid-cols-2 gap-3">
            <Section label="Email verified">
              <TriToggle value={value.emailVerified} onChange={(v) => onChange({ ...value, emailVerified: v })} />
            </Section>
            <Section label="Phone verified">
              <TriToggle value={value.phoneVerified} onChange={(v) => onChange({ ...value, phoneVerified: v })} />
            </Section>
          </div>

          <Section label="Has social">
            <div className="flex gap-1.5">
              {(["linkedin","instagram","facebook"] as const).map((s) => (
                <Chip key={s} active={value.socials.includes(s)} onClick={() => toggleArr("socials", s)}>
                  {s[0].toUpperCase() + s.slice(1)}
                </Chip>
              ))}
            </div>
          </Section>

          {tags.length > 0 && (
            <Section label="Tags">
              <ChipsGrid items={tags} active={value.tags} onToggle={(v) => toggleArr("tags", v)} />
            </Section>
          )}

          {industries.length > 0 && (
            <Section label="Industry">
              <ChipsGrid items={industries} active={value.industries} onToggle={(v) => toggleArr("industries", v)} />
            </Section>
          )}

          <Section label="Company contains">
            <Input
              value={value.company}
              onChange={(e) => onChange({ ...value, company: e.target.value })}
              placeholder="e.g. Acme"
              className="h-9"
            />
          </Section>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-xs border transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 border-border hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function ChipsGrid({ items, active, onToggle }: { items: string[]; active: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
      {items.map((it) => (
        <Chip key={it} active={active.includes(it)} onClick={() => onToggle(it)}>{it}</Chip>
      ))}
    </div>
  );
}

function TriToggle({ value, onChange }: { value: "any" | "yes" | "no"; onChange: (v: "any" | "yes" | "no") => void }) {
  return (
    <div className="flex gap-1">
      {(["any","yes","no"] as const).map((v) => (
        <Chip key={v} active={value === v} onClick={() => onChange(v)}>
          {v[0].toUpperCase() + v.slice(1)}
        </Chip>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}

export function ActiveFilterChips({ value, onChange }: { value: ContactFilterState; onChange: (v: ContactFilterState) => void }) {
  const chips: { label: string; clear: () => void }[] = [];
  value.locations.forEach((l) => chips.push({ label: l, clear: () => onChange({ ...value, locations: value.locations.filter((x) => x !== l) }) }));
  value.scoreTiers.forEach((t) => chips.push({ label: t, clear: () => onChange({ ...value, scoreTiers: value.scoreTiers.filter((x) => x !== t) }) }));
  value.sources.forEach((s) => chips.push({ label: `source:${s}`, clear: () => onChange({ ...value, sources: value.sources.filter((x) => x !== s) }) }));
  if (value.emailVerified !== "any") chips.push({ label: `email:${value.emailVerified}`, clear: () => onChange({ ...value, emailVerified: "any" }) });
  if (value.phoneVerified !== "any") chips.push({ label: `phone:${value.phoneVerified}`, clear: () => onChange({ ...value, phoneVerified: "any" }) });
  value.socials.forEach((s) => chips.push({ label: s, clear: () => onChange({ ...value, socials: value.socials.filter((x) => x !== s) }) }));
  value.tags.forEach((t) => chips.push({ label: `#${t}`, clear: () => onChange({ ...value, tags: value.tags.filter((x) => x !== t) }) }));
  value.industries.forEach((t) => chips.push({ label: t, clear: () => onChange({ ...value, industries: value.industries.filter((x) => x !== t) }) }));
  if (value.company.trim()) chips.push({ label: `co:${value.company}`, clear: () => onChange({ ...value, company: "" }) });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {chips.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/30">
          {c.label}
          <button onClick={c.clear} className="hover:bg-primary/20 rounded-full p-0.5" aria-label="Remove">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button onClick={() => onChange(EMPTY_FILTER)} className="text-xs text-muted-foreground hover:text-foreground px-2">
        Clear all
      </button>
    </div>
  );
}
