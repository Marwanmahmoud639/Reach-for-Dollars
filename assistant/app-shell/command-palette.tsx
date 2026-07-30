import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutGrid, Search, Users, Kanban, Megaphone, BarChart3, UsersRound, Settings,
  Plus, Rocket,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type Contact = { id: string; name: string; company: string | null };
type Campaign = { id: string; name: string };

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const navigate = useNavigate();
  const { team } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    if (!open || !team?.id) return;
    supabase.from("contacts").select("id, name, company").eq("team_id", team.id).limit(50)
      .then(({ data }) => setContacts((data ?? []) as Contact[]));
    supabase.from("campaigns").select("id, name").eq("team_id", team.id).limit(50)
      .then(({ data }) => setCampaigns((data ?? []) as Campaign[]));
  }, [open, team?.id]);

  const go = (path: string) => {
    onOpenChange(false);
    setTimeout(() => navigate({ to: path as any }), 0);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search everything…  (contacts, campaigns, quick actions)" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go("/campaigns")}><Plus className="w-4 h-4" /> New campaign</CommandItem>
          <CommandItem onSelect={() => go("/discovery")}><Rocket className="w-4 h-4" /> Run discovery</CommandItem>
          <CommandItem onSelect={() => go("/pipeline")}><Kanban className="w-4 h-4" /> View pipeline</CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/dashboard")}><LayoutGrid className="w-4 h-4" /> Dashboard</CommandItem>
          <CommandItem onSelect={() => go("/discovery")}><Search className="w-4 h-4" /> Discovery</CommandItem>
          <CommandItem onSelect={() => go("/contacts")}><Users className="w-4 h-4" /> Contacts</CommandItem>
          <CommandItem onSelect={() => go("/pipeline")}><Kanban className="w-4 h-4" /> Pipeline</CommandItem>
          <CommandItem onSelect={() => go("/campaigns")}><Megaphone className="w-4 h-4" /> Campaigns</CommandItem>
          <CommandItem onSelect={() => go("/analytics")}><BarChart3 className="w-4 h-4" /> Analytics</CommandItem>
          <CommandItem onSelect={() => go("/team")}><UsersRound className="w-4 h-4" /> Team</CommandItem>
          <CommandItem onSelect={() => go("/settings")}><Settings className="w-4 h-4" /> Settings</CommandItem>
        </CommandGroup>

        {contacts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Contacts">
              {contacts.map(c => (
                <CommandItem key={c.id} value={`${c.name} ${c.company ?? ""}`} onSelect={() => go("/contacts")}>
                  <Users className="w-4 h-4" />
                  <span>{c.name}</span>
                  {c.company && <span className="ml-auto text-xs text-muted-foreground">{c.company}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {campaigns.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Campaigns">
              {campaigns.map(c => (
                <CommandItem key={c.id} value={c.name} onSelect={() => go("/campaigns")}>
                  <Megaphone className="w-4 h-4" /> {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
