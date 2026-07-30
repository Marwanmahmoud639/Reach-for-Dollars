import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Search as SearchIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { listRecentKeywords } from "@/lib/discovery.functions";

export const POPULAR_KEYWORDS = [
  "cash buyers",
  "real estate wholesalers",
  "real estate investors",
  "property managers",
  "house flippers",
  "motivated sellers",
  "cleaning services",
  "roofing companies",
  "HVAC contractors",
  "plumbing companies",
  "general contractors",
  "B2B software companies",
  "marketing agencies",
  "financial advisors",
  "insurance agents",
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}

interface Item {
  text: string;
  kind: "recent" | "popular";
}

export function KeywordAutocomplete({ value, onChange, placeholder, id }: Props) {
  const fetchRecent = useServerFn(listRecentKeywords);
  const { data } = useQuery({
    queryKey: ["recent-keywords"],
    queryFn: () => fetchRecent(),
    staleTime: 60_000,
  });
  const recent: string[] = data?.keywords ?? [];

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const q = value.trim().toLowerCase();
    if (q.length < 2) return [];
    const r: Item[] = recent
      .filter((s) => s && s.toLowerCase().includes(q))
      .map((text) => ({ text, kind: "recent" as const }));
    const seen = new Set(r.map((i) => i.text.toLowerCase()));
    const p: Item[] = POPULAR_KEYWORDS
      .filter((s) => s.toLowerCase().includes(q) && !seen.has(s.toLowerCase()))
      .map((text) => ({ text, kind: "popular" as const }));
    return [...r, ...p].slice(0, 8);
  }, [value, recent]);

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const select = (text: string) => {
    onChange(text);
    setOpen(false);
  };

  const showDropdown = open && items.length > 0 && value.trim().length >= 2;

  return (
    <div ref={wrapRef} className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-12 pl-9 text-sm"
        autoComplete="off"
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + items.length) % items.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            select(items[highlight].text);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showDropdown && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {items.map((it, i) => (
            <button
              key={`${it.kind}-${it.text}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                select(it.text);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                i === highlight ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
              )}
            >
              {it.kind === "recent" ? (
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <SearchIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{it.text}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                {it.kind === "recent" ? "Recent" : "Popular"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
