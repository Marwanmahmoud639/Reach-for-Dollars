import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronsUpDown, Check, Building2, Users, Shield, LogOut, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listSwitchableTeams,
  switchTeam,
  clearTeamSwitch,
  type SwitchableTeam,
} from "@/lib/teams.functions";

export function TeamSwitcher() {
  const { team, actingTeamId, homeTeam, isImpersonating, isSuperAdmin, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<SwitchableTeam[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useServerFn(listSwitchableTeams);
  const doSwitch = useServerFn(switchTeam);
  const doClear = useServerFn(clearTeamSwitch);

  useEffect(() => {
    if (!open) return;
    list({ data: undefined as any }).then((r) => setTeams(r.teams)).catch(() => {});
  }, [open]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f ? teams.filter((t) => t.name.toLowerCase().includes(f)) : teams;
    return {
      home: filtered.filter((t) => t.is_home),
      children: filtered.filter((t) => t.is_child),
      others: filtered.filter((t) => t.is_super_admin_view),
    };
  }, [teams, filter]);

  // Hide switcher if user has nothing to switch between
  const switchable = teams.length > 1 || isImpersonating || isSuperAdmin;
  if (!team) return null;

  const handleSwitch = async (id: string) => {
    if (id === actingTeamId) { setOpen(false); return; }
    setBusy(true);
    try {
      await doSwitch({ data: { teamId: id } });
      await refresh();
      toast.success("Switched team");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to switch");
    } finally { setBusy(false); }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await doClear({ data: undefined as any });
      await refresh();
      toast.success("Returned to home team");
      setOpen(false);
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 max-w-[220px]"
          disabled={!switchable && !isImpersonating}
        >
          {team.white_label_logo ? (
            <img src={team.white_label_logo} alt="" className="w-4 h-4 rounded" />
          ) : (
            <Building2 className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate text-sm">{team.white_label_name || team.name}</span>
          {isImpersonating && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
              {isSuperAdmin && team.id !== homeTeam?.id ? "SA" : "child"}
            </Badge>
          )}
          {switchable && <ChevronsUpDown className="w-3.5 h-3.5 opacity-60" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find team…"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {groups.home.length > 0 && (
            <Section label="Your team">
              {groups.home.map((t) => (
                <TeamRow key={t.id} t={t} active={t.id === actingTeamId} onClick={() => handleSwitch(t.id)} />
              ))}
            </Section>
          )}
          {groups.children.length > 0 && (
            <Section label="Sub-accounts" icon={Users}>
              {groups.children.map((t) => (
                <TeamRow key={t.id} t={t} active={t.id === actingTeamId} onClick={() => handleSwitch(t.id)} />
              ))}
            </Section>
          )}
          {groups.others.length > 0 && (
            <Section label="All teams (super admin)" icon={Shield}>
              {groups.others.map((t) => (
                <TeamRow key={t.id} t={t} active={t.id === actingTeamId} onClick={() => handleSwitch(t.id)} />
              ))}
            </Section>
          )}
          {teams.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">Loading…</div>
          )}
        </div>
        {isImpersonating && (
          <div className="p-2 border-t border-border">
            <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={handleClear} disabled={busy}>
              <LogOut className="w-3.5 h-3.5 mr-2" /> Return to home team
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Section({ label, icon: Icon, children }: { label: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      {children}
    </div>
  );
}

function TeamRow({ t, active, onClick }: { t: SwitchableTeam; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-sm text-left"
    >
      {t.white_label_logo ? (
        <img src={t.white_label_logo} alt="" className="w-4 h-4 rounded" />
      ) : (
        <Building2 className="w-4 h-4 shrink-0 opacity-60" />
      )}
      <span className="flex-1 truncate">{t.white_label_name || t.name}</span>
      <span className="text-[10px] text-muted-foreground capitalize">{t.plan}</span>
      {active && <Check className="w-3.5 h-3.5 text-primary" />}
    </button>
  );
}
