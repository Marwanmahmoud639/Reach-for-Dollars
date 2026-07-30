import { ReactNode, memo } from "react";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/hooks/use-count-up";
import { Button } from "@/components/ui/button";

type StatAccent = "blue" | "violet" | "emerald" | "amber" | "cyan" | "pink";
const ACCENT: Record<StatAccent, string> = {
  blue: "#2563EB",
  violet: "#7C3AED",
  emerald: "#059669",
  amber: "#D97706",
  cyan: "#0891B2",
  pink: "#DB2777",
};

export const StatCard = memo(function StatCard({
  label, value, trend, spark, icon, accent = "blue", animate = true,
}: {
  label: string;
  value: ReactNode | number;
  trend?: number;
  spark?: number[];
  icon?: ReactNode;
  accent?: StatAccent;
  animate?: boolean;
}) {
  const positive = (trend ?? 0) >= 0;
  const isNumber = typeof value === "number";
  const counted = useCountUp(isNumber ? (value as number) : 0);
  const display = isNumber ? (animate ? counted : (value as number)).toLocaleString() : value;
  const accentColor = ACCENT[accent];

  return (
    <div
      className="relative bg-card border border-border rounded-xl p-5 card-hover-lift shadow-card overflow-hidden"
    >
      <span
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: accentColor }}
        aria-hidden
      />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
          {label}
        </span>
        <span className="text-muted-foreground/80">{icon}</span>
      </div>
      <div className="text-3xl font-bold tabular-nums" style={{ fontFamily: "Sora" }}>{display}</div>
      <div className="flex items-end justify-between mt-3 min-h-6">
        {trend !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
              positive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400",
            )}
          >
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        ) : <span />}
        {spark && spark.length > 1 && <MiniSpark data={spark} color={accentColor} />}
      </div>
    </div>
  );
});

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const W = 80, H = 26;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * H}`).join(" ");
  return (
    <svg width={W} height={H} className="opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function PageHeader({
  title, subtitle, greeting, children,
}: {
  title: string;
  subtitle?: string;
  greeting?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ fontFamily: "Sora" }}>{title}</h1>
        {greeting && <p className="text-sm text-muted-foreground mt-1">{greeting}</p>}
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon,
  dashed = true,
  size = "md",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: LucideIcon;
  dashed?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const pad = size === "sm" ? "p-6" : size === "lg" ? "p-14" : "p-10";
  return (
    <div
      className={cn(
        "rounded-xl text-center flex flex-col items-center",
        dashed ? "border border-dashed border-border" : "border border-border",
        "bg-gradient-to-b from-card/60 to-card/20",
        pad,
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/40 text-muted-foreground">
          <Icon className="w-8 h-8" />
        </div>
      )}
      <div className="text-base font-semibold" style={{ fontFamily: "Sora" }}>{title}</div>
      <div className="text-sm text-muted-foreground mt-1 mb-4 max-w-md">{body}</div>
      {action}
    </div>
  );
}

export function StatBadge({ value, label }: { value: ReactNode; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" disabled className="hidden">
      <span>{label}: {value}</span>
    </Button>
  );
}
