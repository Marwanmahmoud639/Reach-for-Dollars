import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMapsBrowserKey } from "@/lib/discovery.functions";
import { Card } from "@/components/ui/card";
import { Loader2, MapPin } from "lucide-react";

declare global {
  interface Window {
    google?: any;
    __mapsLoaderPromise?: Promise<void>;
  }
}

function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__mapsLoaderPromise) return window.__mapsLoaderPromise;
  window.__mapsLoaderPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(s);
  });
  return window.__mapsLoaderPromise;
}

type Pin = { lat: number; lng: number; title?: string };

export function ResultsMap({
  centerLat,
  centerLng,
  pins = [],
  height = 280,
}: {
  centerLat: number | null | undefined;
  centerLng: number | null | undefined;
  pins?: Pin[];
  height?: number;
}) {
  const fetchKey = useServerFn(getMapsBrowserKey);
  const { data: keyData } = useQuery({
    queryKey: ["maps-browser-key"],
    queryFn: () => fetchKey(),
    staleTime: 5 * 60 * 1000,
  });
  const ref = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!keyData?.key || !ref.current || centerLat == null || centerLng == null) return;
    let cancelled = false;
    loadMaps(keyData.key)
      .then(() => {
        if (cancelled || !ref.current || !window.google?.maps) return;
        const map = new window.google.maps.Map(ref.current, {
          zoom: 10,
          center: { lat: centerLat, lng: centerLng },
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
            { featureType: "water", stylers: [{ color: "#0a0a0a" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2a2a" }] },
          ],
        });
        new window.google.maps.Marker({
          map,
          position: { lat: centerLat, lng: centerLng },
          title: "Search center",
        });
        for (const p of pins) {
          new window.google.maps.Marker({ map, position: { lat: p.lat, lng: p.lng }, title: p.title });
        }
      })
      .catch((e) => setErr(String(e.message || e)));
    return () => { cancelled = true; };
  }, [keyData?.key, centerLat, centerLng, pins]);

  if (!keyData) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground" style={{ height }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading map…
      </Card>
    );
  }
  if (!keyData.key) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground" style={{ height }}>
        <MapPin className="w-4 h-4" /> Add a Google Maps API key in Settings to enable the map view.
      </Card>
    );
  }
  if (centerLat == null || centerLng == null) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground" style={{ height }}>
        <MapPin className="w-4 h-4" /> No geocoded location for this search yet.
      </Card>
    );
  }
  if (err) {
    return (
      <Card className="p-4 text-sm text-destructive" style={{ height }}>
        Map error: {err}
      </Card>
    );
  }
  return <Card className="overflow-hidden" style={{ height }}><div ref={ref} className="w-full h-full" /></Card>;
}
