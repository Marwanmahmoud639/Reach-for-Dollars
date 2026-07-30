import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { trackPageView } from "@/lib/analytics";

export function AnalyticsTracker() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === path) return;
    last.current = path;
    trackPageView(path);
  }, [path]);
  return null;
}
