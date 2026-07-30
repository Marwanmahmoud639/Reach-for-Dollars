import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid, Search, Users, Kanban, Megaphone, MoreHorizontal, Settings, BarChart3,
  UsersRound, Shield, Zap, Inbox, MapPin, GitBranch, FileText, Radar, Share2, Building2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Role } from "@/lib/auth";
import { hasSection, type SectionKey } from "@/lib/roles";
import { IS_AGENCY } from "@/lib/brand";

type Item = { to: string; label: string; icon: any; roles: Role[]; section?: SectionKey; superOnly?: boolean; agencyOnly?: boolean; agencyAdminOnly?: boolean };

// Four primary tabs always shown in the bar. Everything else lives in "More".
const PRIMARY: Item[] = [
  { to: "/dashboard", label: "Home",     icon: LayoutGrid, roles: ["admin", "manager", "agent"], section: "dashboard" },
  { to: "/pipeline",  label: "Pipeline", icon: Kanban,     roles: ["admin", "manager", "agent"], section: "pipeline" },
  { to: "/contacts",  label: "Contacts", icon: Users,      roles: ["admin", "manager", "agent"], section: "contacts" },
  { to: "/inbox",     label: "Inbox",    icon: Inbox,      roles: ["admin", "manager", "agent"], section: "inbox" },
];

// MORE mirrors the FULL desktop sidebar so every section is reachable on mobile.
const MORE: Item[] = [
  { to: "/discovery",   label: "Discovery",   icon: Search,     roles: ["admin", "manager"],          section: "discovery" },
  { to: "/areas",       label: "Areas",       icon: MapPin,     roles: ["admin", "manager", "agent"], section: "areas" },
  { to: "/campaigns",   label: "Campaigns",   icon: Megaphone,  roles: ["admin", "manager"],          section: "campaigns" },
  { to: "/workflows",   label: "Workflows",   icon: GitBranch,  roles: ["admin", "manager"],          section: "workflows" },
  { to: "/automations", label: "Automations", icon: Zap,        roles: ["admin", "manager"],          section: "automations" },
  { to: "/proposals",   label: "Proposals",   icon: FileText,   roles: ["admin", "manager"],          section: "proposals", agencyOnly: true },
  { to: "/monitors",    label: "Monitors",    icon: Radar,      roles: ["admin", "manager"],          section: "monitors" },
  { to: "/portals",     label: "Portals",     icon: Share2,     roles: ["admin", "manager"],          section: "portals" },
  { to: "/analytics",   label: "Analytics",   icon: BarChart3,  roles: ["admin", "manager"],          section: "analytics" },
  { to: "/team",        label: "Team",        icon: UsersRound, roles: ["admin"],                     section: "team" },
  { to: "/agency",      label: "Agency",      icon: Building2,  roles: [], superOnly: true },
  { to: "/settings",    label: "Settings",    icon: Settings,   roles: ["admin", "manager"],          section: "settings" },
  { to: "/super-admin", label: "Super Admin", icon: Shield,     roles: [], superOnly: true },
];

export function BottomNav() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const { isSuperAdmin, role, sectionAccess, team } = useAuth();
  const [open, setOpen] = useState(false);
  const isAgencyAdmin = (role === "admin" && !!team && team.parent_team_id === null) || isSuperAdmin;

  const allow = (it: Item) => {
    if (it.superOnly) return isSuperAdmin;
    if (it.agencyAdminOnly && !isAgencyAdmin) return false;
    if (it.agencyOnly && !IS_AGENCY) return false;
    if (!role) return true;
    if (!it.roles.includes(role) && !(it.agencyAdminOnly && isSuperAdmin)) return false;
    if (it.section) return hasSection(role, sectionAccess, it.section);
    return true;
  };

  const visiblePrimary = PRIMARY.filter(allow);
  const moreVisible = MORE.filter(allow);
  const cols = visiblePrimary.length + (moreVisible.length ? 1 : 0);

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar border-t border-sidebar-border shadow-sidebar">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {visiblePrimary.map(it => {
          const Icon = it.icon;
          const active = pathname === it.to || pathname.startsWith(it.to + "/");
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-5 h-5" />
              <span>{it.label}</span>
            </Link>
          );
        })}
        {moreVisible.length > 0 && (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className={cn(
                "flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors",
                moreVisible.some(m => pathname.startsWith(m.to)) ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}>
                <MoreHorizontal className="w-5 h-5" />
                <span>More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
              <SheetHeader><SheetTitle>All sections</SheetTitle></SheetHeader>
              <div className="grid grid-cols-3 gap-3 pt-4 pb-[env(safe-area-inset-bottom)]">
                {moreVisible.map(m => {
                  const Icon = m.icon;
                  const active = pathname === m.to || pathname.startsWith(m.to + "/");
                  return (
                    <Link
                      key={m.to}
                      to={m.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-card border transition-colors",
                        active ? "border-primary/60 bg-primary/[0.06]" : "border-border hover:border-primary/40",
                      )}
                    >
                      <Icon className="w-5 h-5 text-primary" />
                      <span className="text-xs font-medium text-center">{m.label}</span>
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
      <div style={{ height: "env(safe-area-inset-bottom)" }} />
    </nav>
  );
}
