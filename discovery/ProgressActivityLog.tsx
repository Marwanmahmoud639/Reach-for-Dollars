import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type Activity = {
  id: string;
  search_id: string;
  step: string;
  status: string;
  icon: string | null;
  message: string;
  count: number | null;
  percent: number | null;
  created_at: string;
};

/** Mirrors RUN_BUDGET_MS in the discovery-run edge function. Keep in step. */
const RUN_BUDGET_MS = 150_000;

const STEP_LABELS: Record<string, string> = {
  start: "Starting",
  business: "Searching directories",
  decisionmakers: "Identifying decision-makers",
  social: "Fetching social profiles",
  skiptrace: "Skip-tracing",
  verify: "Verifying contacts",
  score: "Scoring leads",
  finalize: "Finalizing",
  error: "Error",
};

/**
 * Bar, percentage, and the current step. Nothing else.
 *
 * The activity rows are still written and still read here — they drive the
 * percentage and the step label — they're just not rendered as a log. Keeping
 * the query means the bar stays live over Realtime, and it means the detail is
 * still there in `search_activity` for debugging a bad run without putting a
 * wall of tool names in front of the user.
 */
export function ProgressActivityLog({
  searchId,
  searchStatus,
}: {
  searchId: string;
  searchStatus?: string | null;
}) {
  const qc = useQueryClient();
  const isDone = searchStatus === "complete" || searchStatus === "partial" || searchStatus === "failed";

  const { data: activity = [] } = useQuery<Activity[]>({
    queryKey: ["search_activity", searchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("search_activity")
        .select("*")
        .eq("search_id", searchId)
        .order("created_at", { ascending: true });
      return (data as Activity[]) || [];
    },
    // Polling fallback in case Realtime drops a message while the search is running.
    refetchInterval: isDone ? false : 2000,
  });

  useEffect(() => {
    if (!searchId) return;
    const ch = supabase
      .channel(`search-activity-${searchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "search_activity", filter: `search_id=eq.${searchId}` },
        () => qc.invalidateQueries({ queryKey: ["search_activity", searchId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [searchId, qc]);

  const latestPercent = [...activity].reverse().find((a) => typeof a.percent === "number")?.percent ?? 0;
  const percent = isDone ? 100 : latestPercent;
  const latest = activity[activity.length - 1];
  const stepLabel = latest ? STEP_LABELS[latest.step] ?? latest.step : "Initializing";

  // Re-render every second so the countdown actually counts. Without this the
  // figure only moved when the activity query refetched, which made it read as
  // a static label rather than a timer.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (isDone) return;
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isDone]);

  const startedAt = activity.length ? new Date(activity[0].created_at).getTime() : null;
  const elapsedMs = startedAt ? Date.now() - startedAt : 0;

  /**
   * Time remaining, counted down against the run's own server-side ceiling.
   *
   * The earlier version projected from progress alone, so it showed nothing
   * until the run was 5% in — which in practice meant nothing until the
   * decision-maker step. Anchoring to the known budget means there's a figure
   * from the first second, and blending in the observed pace lets it correct
   * itself once there's enough signal to do so honestly.
   */
  const eta = (() => {
    if (isDone || !startedAt) return null;
    const budgetRemaining = RUN_BUDGET_MS - elapsedMs;
    const paced = percent >= 8 && elapsedMs > 5000
      ? (elapsedMs / percent) * (100 - percent)
      : null;
    // Never promise longer than the server will actually allow.
    const remaining = Math.min(paced ?? budgetRemaining, budgetRemaining);
    if (remaining <= 0) return "finishing up";
    const mins = Math.floor(remaining / 60_000);
    const secs = Math.floor((remaining % 60_000) / 1000);
    if (mins <= 0) return `${secs}s left`;
    return `${mins}:${secs.toString().padStart(2, "0")} left`;
  })();

  /** Running totals, so the numbers move while the run is in flight. */
  const counts = (() => {
    const pick = (step: string) =>
      [...activity].reverse().find((a) => a.step === step && typeof a.count === "number")?.count ?? null;
    return [
      { label: "Businesses", value: pick("business") },
      { label: "Decision makers", value: pick("decisionmakers") },
      { label: "Contacts", value: pick("skiptrace") },
      { label: "Verified", value: pick("verify") },
    ].filter((c) => c.value !== null);
  })();

  const statusText = isDone
    ? searchStatus === "failed"
      ? "Search failed"
      : "Search complete"
    : `${stepLabel}…`;

  return (
    <Card className="p-5 space-y-3 card-hover-lift">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ fontFamily: "Sora" }}>
          Live Progress
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">{percent}%</span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground/90">{statusText}</span>
        {eta && <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{eta}</span>}
      </div>
      <Progress value={percent} className="h-3" />
      {counts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {counts.map((c) => (
            <div key={c.label} className="rounded-md border border-border bg-background/40 px-2.5 py-2">
              <div className="text-lg font-semibold tabular-nums leading-none">{c.value?.toLocaleString()}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{c.label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
