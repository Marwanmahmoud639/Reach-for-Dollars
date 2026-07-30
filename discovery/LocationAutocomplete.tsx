import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, LocateFixed, Loader2, Globe2 } from "lucide-react";
import { US_STATES } from "@/lib/us-locations";
import { toast } from "sonner";

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

interface NominatimResult {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

/** Two-letter code for a state name, so results read "Austin, TX". */
const STATE_CODE = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s.code]));

function formatResult(r: NominatimResult): string {
  const a = r.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.county;
  const state = a.state ? (STATE_CODE.get(a.state.toLowerCase()) ?? a.state) : undefined;
  const parts = [city, state].filter(Boolean);
  return parts.length ? parts.join(", ") : r.display_name.split(",").slice(0, 2).join(",").trim();
}

export function LocationAutocomplete({ id, value, onChange, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 2) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      // Typing a state name or code offers the whole state, so a nationwide
      // operator can search "Texas" without naming a city.
      const stateMatches = US_STATES
        .filter((s) =>
          s.name.toLowerCase().startsWith(query.toLowerCase()) ||
          s.code.toLowerCase() === query.toLowerCase(),
        )
        .map((s) => `${s.name}, ${s.code}`);

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&q=${encodeURIComponent(query)}&limit=6`,
          { headers: { "Accept-Language": "en-US,en" } },
        );
        const data: NominatimResult[] = res.ok ? await res.json() : [];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const label of [...stateMatches, ...data.map(formatResult)]) {
          if (label && !seen.has(label)) { seen.add(label); out.push(label); }
        }
        setSuggestions(out.slice(0, 8));
        setOpen(out.length > 0);
      } catch {
        // Offline or rate-limited: state matches are local, so still useful.
        setSuggestions(stateMatches);
        setOpen(stateMatches.length > 0);
      }
    }, 350);
  }, []);

  /** Ask the browser where we are, then turn coordinates into "City, ST". */
  const detectLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("This browser can't detect location. Type a city or state instead.");
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${latitude}&lon=${longitude}`,
            { headers: { "Accept-Language": "en-US,en" } },
          );
          if (!res.ok) throw new Error("Lookup failed");
          const data: NominatimResult = await res.json();
          if (data.address?.country_code && data.address.country_code.toLowerCase() !== "us") {
            toast.error("Discovery covers the United States only. Type a US city or state.");
            return;
          }
          const label = formatResult(data);
          if (!label) throw new Error("Could not name that location");
          onChange(label);
          setSuggestions([]);
          setOpen(false);
          toast.success(`Location set to ${label}`);
        } catch {
          toast.error("Couldn't work out your city. Type it instead.");
        } finally {
          setDetecting(false);
        }
      },
      (err) => {
        setDetecting(false);
        // Permission denial is a choice, not a fault — say what to do next.
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Type a city or state instead."
            : "Couldn't get your location. Type a city or state instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [onChange]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
          <Input
            id={id}
            value={value}
            onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder || "Detect, or type any US city or state"}
            className="h-12 pl-9 text-sm"
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-12 shrink-0"
          onClick={detectLocation}
          disabled={detecting}
          title="Use my current location"
        >
          {detecting
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <LocateFixed className="w-4 h-4" />}
          <span className="ml-1.5 hidden sm:inline">{detecting ? "Detecting…" : "Detect"}</span>
        </Button>
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-center gap-2 border-b border-border/40 last:border-0"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setSuggestions([]);
                setOpen(false);
              }}
            >
              {/* A bare "State, XX" entry means the whole state, not a city in it. */}
              {/^[^,]+,\s*[A-Z]{2}$/.test(s) && US_STATES.some((st) => `${st.name}, ${st.code}` === s)
                ? <Globe2 className="w-3 h-3 text-muted-foreground shrink-0" />
                : <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />}
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
