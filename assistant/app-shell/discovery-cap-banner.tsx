import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shown on the Discovery page when the team has consumed its monthly
 * discovery records. Offers two paths: upgrade plan (scale up) or wait for
 * the monthly renewal.
 */
export function DiscoveryCapBanner() {
  const { team, role, isSuperAdmin } = useAuth();
  const [used, setUsed] = useState<number | null>(null);
  const limit = (team as any)?.discovery_monthly_limit ?? 1000;

  useEffect(() => {
    if (!team?.id) return;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    let cancelled = false;
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id)
      .eq("source", "discovery")
      .gte("created_at", start.toISOString())
      .then(({ count }) => { if (!cancelled) setUsed(count ?? 0); });
    return () => { cancelled = true; };
  }, [team?.id]);

  if (used === null || used < limit) return null;

  const nextRenewal = new Date();
  nextRenewal.setMonth(nextRenewal.getMonth() + 1, 1);
  nextRenewal.setHours(0, 0, 0, 0);

  const canUpgrade = role === "admin" || isSuperAdmin;
  const upgradeHref = (team as any)?.parent_team_id ? "/settings" : "/settings";

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">
          You've used all {limit.toLocaleString()} discovery records this month
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scale to a bigger plan to unlock more records now, or wait until{" "}
          <span className="font-medium">{nextRenewal.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span> when your subscription renews.
        </p>
      </div>
      {canUpgrade && (
        <Link
          to={upgradeHref}
          className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-amber-500 text-white text-xs font-medium hover:brightness-110 whitespace-nowrap"
        >
          Upgrade plan <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}
