import { Bell, LogOut, Sun, Moon, Monitor, ChevronDown, Search as SearchIcon, CheckCircle2, AlertTriangle, Info, User as UserIcon, Command as CmdIcon } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CommandPalette } from "./command-palette";
import { TeamSwitcher } from "./team-switcher";
import { DiscoveryCreditsBadge } from "./discovery-credits-badge";
import { cn } from "@/lib/utils";

type Notif = { id: string; title: string; body: string | null; read: boolean; created_at: string; type?: string | null };

function notifKind(n: Notif): "info" | "success" | "warning" {
  const t = (n.type || "").toLowerCase();
  if (["success", "ok", "done", "completed"].includes(t)) return "success";
  if (["warn", "warning", "error", "failed", "alert"].includes(t)) return "warning";
  return "info";
}

const KIND_STYLE: Record<"info" | "success" | "warning", { border: string; icon: ComponentType<{ className?: string }>; iconClass: string }> = {
  info: { border: "border-l-blue-500", icon: Info, iconClass: "text-blue-500" },
  success: { border: "border-l-emerald-500", icon: CheckCircle2, iconClass: "text-emerald-500" },
  warning: { border: "border-l-amber-500", icon: AlertTriangle, iconClass: "text-amber-500" },
};

export function Navbar() {
  const { profile, role, team, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const unread = notifs.filter(n => !n.read).length;

  useEffect(() => {
    if (!team?.id) return;
    supabase.from("notifications").select("*").eq("team_id", team.id).order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setNotifs((data ?? []) as Notif[]));
    const ch = supabase.channel("notif").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `team_id=eq.${team.id}` },
      (p) => setNotifs(prev => [p.new as Notif, ...prev].slice(0, 20))).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [team?.id]);

  // Cmd+K listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const markAllRead = async () => {
    if (!team?.id) return;
    await supabase.from("notifications").update({ read: true }).eq("team_id", team.id).eq("read", false);
    setNotifs(n => n.map(x => ({ ...x, read: true })));
  };

  const initials = (profile?.name || profile?.email || "?").slice(0, 2).toUpperCase();
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const plan = team?.plan ? String(team.plan).charAt(0).toUpperCase() + String(team.plan).slice(1) : null;

  return (
    <>
      <header className="h-16 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between px-4 gap-3">
        <div className="md:hidden text-lg font-bold brand-gradient" style={{ fontFamily: "Sora" }}>
          {team?.white_label_name || "C4D"}
        </div>

        <TeamSwitcher />



        {/* Command palette pill */}
        <div className="flex-1 flex justify-center">
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-3 w-full max-w-md h-10 px-3 rounded-lg border border-border bg-background/60 hover:bg-background hover:border-primary/40 text-sm text-muted-foreground transition-colors"
          >
            <SearchIcon className="w-4 h-4" />
            <span className="flex-1 text-left">Search everything…</span>
            <kbd className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] font-mono">
              <CmdIcon className="w-3 h-3" />K
            </kbd>
          </button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setPaletteOpen(true)}>
            <SearchIcon className="w-4 h-4" />
          </Button>
        </div>

        <DiscoveryCreditsBadge />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme"><ThemeIcon className="w-4 h-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="w-4 h-4 mr-2" />Light</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="w-4 h-4 mr-2" />Dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="w-4 h-4 mr-2" />System</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="w-4 h-4" />
              {unread > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 text-[10px] rounded-full bg-primary text-primary-foreground flex items-center justify-center">{unread}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
              {unread > 0 && <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-auto">
              {notifs.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">All caught up</div>}
              {notifs.map(n => {
                const kind = notifKind(n);
                const { border, icon: Icon, iconClass } = KIND_STYLE[kind];
                return (
                  <div key={n.id} className={cn("flex gap-3 px-3 py-2.5 border-b border-border/60 border-l-2", border, !n.read && "bg-primary/[0.04]")}>
                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", iconClass)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground/70 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-border text-center">
              <Link to="/dashboard" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-accent transition-colors">
              <Avatar className="w-8 h-8">
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="Avatar" />}
                <AvatarFallback className="text-xs bg-primary text-primary-foreground">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start leading-tight">
                <span className="text-sm font-medium">{profile?.name || profile?.email}</span>
                <div className="flex items-center gap-1">
                  {role && <Badge variant="secondary" className="text-[10px] h-4 px-1 capitalize">{role}</Badge>}
                  {plan && <Badge className="text-[10px] h-4 px-1 bg-primary/15 text-primary border-0">{plan}</Badge>}
                </div>
              </div>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{profile?.name || profile?.email}</div>
              <div className="text-xs text-muted-foreground truncate">{profile?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings"><UserIcon className="w-4 h-4 mr-2" />Profile Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}><LogOut className="w-4 h-4 mr-2" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
