import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid, Search, Users, Kanban, Megaphone, BarChart3, UsersRound, Settings,
  ChevronsLeft, ChevronsRight, Shield, Zap, GitBranch, FileText, Share2, Radar, Inbox, MapPin, Building2, PhoneCall,
  Brain, BookOpen,
} from "lucide-react";
import { useState, memo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/auth";
import { hasSection, type SectionKey } from "@/lib/roles";
import { BRAND, IS_AGENCY } from "@/lib/brand";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/theme";
import logoDark from "@/assets/logo-dark.png";
import logoLight from "@/assets/logo-light.png";

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; roles: Role[]; section?: SectionKey; superOnly?: boolean; agencyOnly?: boolean; agencyAdminOnly?: boolean; group: "main" | "core" | "manage" };
const ITEMS: NavItem[] = [
  { to: "/dashboard", section: "dashboard",   label: "Dashboard",   icon: LayoutGrid,  roles: ["admin", "manager", "agent"], group: "main" },
  { to: "/pipeline", section: "pipeline",    label: "Pipeline",    icon: Kanban,      roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/inbox", section: "inbox",       label: "Inbox",       icon: Inbox,       roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/contacts", section: "contacts",    label: "Contacts",    icon: Users,       roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/discovery", section: "discovery",   label: "Discovery",   icon: Search,      roles: ["admin", "manager"],          group: "core" },
  { to: "/areas", section: "areas",       label: "Areas",       icon: MapPin,      roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/campaigns", section: "campaigns",   label: "Campaigns",   icon: Megaphone,   roles: ["admin", "manager"],          group: "core" },
  { to: "/workflows", section: "workflows",   label: "Workflows",   icon: GitBranch,   roles: ["admin", "manager"],          group: "core" },
  { to: "/automations", section: "automations", label: "Automations", icon: Zap,         roles: ["admin", "manager"],          group: "core" },
  { to: "/proposals", section: "proposals",   label: "Proposals",   icon: FileText,    roles: ["admin", "manager"], agencyOnly: true, group: "core" },
  { to: "/monitors", section: "monitors",    label: "Monitors",    icon: Radar,       roles: ["admin", "manager"],          group: "core" },
  { to: "/portals", section: "portals",     label: "Portals",     icon: Share2,      roles: ["admin", "manager"],          group: "core" },
  { to: "/ai-caller", section: "ai_caller",  label: "AI Caller",   icon: PhoneCall,   roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/intelligence", section: "intelligence", label: "Intelligence", icon: Brain, roles: ["admin", "manager"],          group: "core" },
  { to: "/knowledge-base", section: "knowledge_base", label: "Knowledge Base", icon: BookOpen, roles: ["admin", "manager", "agent"], group: "core" },
  { to: "/analytics", section: "analytics",   label: "Analytics",   icon: BarChart3,   roles: ["admin", "manager"],          group: "manage" },
  { to: "/team", section: "team",        label: "Team",        icon: UsersRound,  roles: ["admin"],                     group: "manage" },
  { to: "/agency", label: "Agency",      icon: Building2,   roles: [], superOnly: true,                  group: "manage" },
  { to: "/settings", section: "settings",    label: "Settings",    icon: Settings,    roles: ["admin", "manager"],          group: "manage" },
  { to: "/super-admin", label: "Super Admin", icon: Shield,      roles: [], superOnly: true,           group: "manage" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: s => s.location.pathname });
  const { role, team, isSuperAdmin, sectionAccess } = useAuth();
  const { resolved } = useTheme();
  const logoSrc = resolved === "dark" ? logoDark : logoLight;
  const brand = team?.white_label_name || BRAND.long;
  const brandEyebrow = team?.white_label_name ? null : BRAND.eyebrow;

  const isAgencyAdmin = (role === "admin" && !!team && team.parent_team_id === null) || isSuperAdmin;
  const visible = ITEMS.filter(i => {
    if (i.superOnly) return isSuperAdmin;
    if (i.agencyAdminOnly && !isAgencyAdmin) return false;
    if (i.agencyOnly && !IS_AGENCY) return false;
    if (!role) return true;
    if (!i.roles.includes(role) && !(i.agencyAdminOnly && isSuperAdmin)) return false;
    if (i.section) return hasSection(role, sectionAccess, i.section);
    return true;
  });
  const groups: NavItem["group"][] = ["main", "core", "manage"];

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className={cn(
          "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border shadow-sidebar transition-all duration-200 ease-in-out",
          collapsed ? "w-[60px]" : "w-[224px]",
        )}
      >
        <div className={cn("flex items-center h-16 border-b border-sidebar-border", collapsed ? "justify-center" : "px-4 justify-between gap-2")}>
          {collapsed ? (
            <img
              src={logoSrc}
              alt=""
              aria-hidden
              className="h-7 w-7 object-contain opacity-60 hover:opacity-100 transition-opacity"
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={logoSrc}
                alt=""
                aria-hidden
                className="h-8 w-8 object-contain opacity-70 hover:opacity-100 transition-opacity shrink-0"
              />
              <div className="leading-tight min-w-0">
                {brandEyebrow && (
                  <div className="text-[9px] tracking-[0.3em] text-muted-foreground font-mono">{brandEyebrow}</div>
                )}
                <div
                  className="text-base font-bold tracking-tight brand-gradient truncate"
                  style={{ fontFamily: "Sora", letterSpacing: "0.01em" }}
                >
                  {brand}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground transition-colors shrink-0"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {groups.map((g, gi) => {
            const items = visible.filter(i => i.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g}>
                {gi > 0 && <div className={cn("mx-3 my-2 h-px bg-sidebar-border/70", collapsed && "mx-2")} />}
                <div className="space-y-0.5">
                  {items.map(item => (
                    <NavItemRow
                      key={item.to}
                      item={item}
                      collapsed={collapsed}
                      active={pathname === item.to || pathname.startsWith(item.to + "/")}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="px-4 py-3 border-t border-sidebar-border text-[10px] uppercase tracking-widest text-muted-foreground/70 font-mono">
            DFD · Internal
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}

const NavItemRow = memo(function NavItemRow({
  item, collapsed, active,
}: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      className={cn(
        "group relative flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm font-medium overflow-hidden transition-all duration-150",
        active
          ? "text-sidebar-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
        collapsed && "justify-center px-2",
      )}
      style={
        active
          ? {
              background:
                "linear-gradient(90deg, color-mix(in oklab, var(--primary) 22%, transparent) 0%, transparent 100%)",
            }
          : undefined
      }
    >
      {active && (
        <span
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary"
          aria-hidden
        />
      )}
      <Icon className={cn("w-[18px] h-[18px] shrink-0 transition-colors", active ? "text-primary" : "")} />
      <span
        className={cn(
          "transition-[max-width,opacity,transform] duration-200 whitespace-nowrap",
          collapsed ? "max-w-0 opacity-0 -translate-x-1" : "max-w-[140px] opacity-100 translate-x-0",
        )}
      >
        {item.label}
      </span>
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
});
