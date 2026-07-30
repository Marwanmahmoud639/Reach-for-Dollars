import { useEffect } from "react";

const ROOT = "dialingfordollars.co";
const RESERVED = new Set(["www", "app", "api", "admin", "leads", "mail", "smtp", "dev", "staging", "preview", "test", "static", "cdn"]);

export function SubdomainBrandBoot() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname.toLowerCase();
    if (!host.endsWith("." + ROOT)) return;
    const sub = host.slice(0, -1 - ROOT.length);
    if (!sub || sub.includes(".") || RESERVED.has(sub)) return;

    let cancelled = false;
    fetch(`/api/public/brand/${encodeURIComponent(sub)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (cancelled || !b?.found) return;
        const root = document.documentElement;
        if (b.primary) root.style.setProperty("--primary", b.primary);
        if (b.secondary) root.style.setProperty("--secondary", b.secondary);
        if (b.name) document.title = b.name;
        if (b.logo) {
          let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = b.logo;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
