import { Link } from "@tanstack/react-router";
import { Sparkles, Infinity as InfinityIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function DiscoveryCreditsBadge() {
  const { team, isSuperAdmin } = useAuth();
  if (!team?.id) return null;

  if (isSuperAdmin) {
    return (
      <span
        className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-medium leading-none whitespace-nowrap"
        title="Super admin · unlimited access"
      >
        <InfinityIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="font-semibold">Unlimited</span>
        <span className="opacity-70">credits</span>
      </span>
    );
  }

  const total = Number((team as any)?.credits_total ?? 100);
  const used = Number((team as any)?.credits_used ?? 0);
  const remaining = Math.max(0, total - used);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const tone =
    pct >= 100 ? "text-red-500 border-red-500/40 bg-red-500/10"
    : pct >= 90 ? "text-amber-500 border-amber-500/40 bg-amber-500/10"
    : "text-primary border-primary/30 bg-primary/10";

  return (
    <Link
      to="/credits"
      className={cn(
        "hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-medium leading-none whitespace-nowrap transition-colors hover:brightness-110",
        tone,
      )}
      title={`Credits used this cycle: ${fmt(used)} of ${fmt(total)} · click for details`}
    >
      <Sparkles className="w-3.5 h-3.5 shrink-0" />
      <span className="font-semibold">{fmt(remaining)}</span>
      <span className="opacity-70">/ {fmt(total)} credits</span>
    </Link>
  );
}
