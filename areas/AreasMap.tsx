import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LeadPinCard, type MapContact } from "./LeadPinCard";
import { useLeadDrawer } from "@/components/contacts/lead-drawer-provider";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const GOOGLE_MAPS_CHANNEL: string | undefined = undefined;

function loadGoogleMaps(): Promise<void> {
  if ((window as any).google?.maps) return Promise.resolve();
  if ((window as any)._gmapsLoading) return (window as any)._gmapsLoading;
  if (!GOOGLE_MAPS_KEY) {
    return Promise.reject(new Error("Google Maps not configured"));
  }
  const p = new Promise<void>((resolve, reject) => {
    (window as any).__initGoogleMaps = () => resolve();
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_KEY,
      libraries: "marker,places",
      loading: "async",
      callback: "__initGoogleMaps",
    });
    if (GOOGLE_MAPS_CHANNEL) params.set("channel", GOOGLE_MAPS_CHANNEL);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  (window as any)._gmapsLoading = p;
  return p;
}


function getMarkerColor(contact: MapContact): string {
  if (contact.lead_score >= 80) return "#ef4444";
  if (contact.status === "closed") return "#6b7280";
  if (contact.status === "contacted") return "#eab308";
  if (!contact.company) return "#22c55e";
  return "#3b82f6";
}

export function AreasMap({
  contacts,
  viewMode,
}: {
  contacts: MapContact[];
  viewMode: "pins" | "heatmap";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const circlesRef = useRef<any[]>([]);
  const [hover, setHover] = useState<{ contact: MapContact; x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { openLead } = useLeadDrawer();
  const openLeadRef = useRef(openLead);
  useEffect(() => { openLeadRef.current = openLead; }, [openLead]);

  useEffect(() => {
    loadGoogleMaps()
      .then(() => setMapsLoaded(true))
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (!mapsLoaded || !containerRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(containerRef.current, {
      zoom: 4,
      center: { lat: 39.8283, lng: -98.5795 },
      mapTypeId: "roadmap",
      styles: [
        { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
        { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#8e9cb5" }] },
        { featureType: "road", elementType: "geometry", stylers: [{ color: "#2d2d44" }] },
        { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1a2e" }] },
        { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
        { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3d3d5c" }] },
        { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1a1a2e" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1b2a" }] },
        { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
        { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
        { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#64779e" }] },
        { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
        { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b737e" }] },
        { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
      ],
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      rotateControl: false,
      fullscreenControl: true,
    });
  }, [mapsLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapsLoaded) return;
    const g = (window as any).google;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current = [];

    const validContacts = contacts.filter((c) => c.lat != null && c.lng != null);
    if (!validContacts.length) return;

    if (viewMode === "heatmap") {
      // HeatmapLayer was removed in Maps JS v3.65. Use weighted translucent
      // circles instead — they stack additively to create a density effect.
      const tiers = [
        { max: 20, radius: 600, opacity: 0.15, color: "#22d3ee" },
        { max: 50, radius: 1200, opacity: 0.22, color: "#3b82f6" },
        { max: 80, radius: 2000, opacity: 0.3, color: "#f97316" },
        { max: 101, radius: 3000, opacity: 0.4, color: "#ef4444" },
      ];
      validContacts.forEach((contact) => {
        const score = contact.lead_score ?? 0;
        const tier = tiers.find((t) => score < t.max) ?? tiers[tiers.length - 1];
        const circle = new g.maps.Circle({
          map,
          center: { lat: contact.lat!, lng: contact.lng! },
          radius: tier.radius,
          strokeOpacity: 0,
          fillColor: tier.color,
          fillOpacity: tier.opacity,
          clickable: false,
        });
        circlesRef.current.push(circle);
      });
      const bounds = new g.maps.LatLngBounds();
      validContacts.forEach((c) => bounds.extend({ lat: c.lat!, lng: c.lng! }));
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
      }
    } else {
      // Businesses sharing an address — a plaza, a tower, a strip mall — geocode
      // to identical coordinates, so their markers land exactly on top of each
      // other and only the last one is clickable. Fan duplicates out around a
      // small circle so each business is individually visible and selectable.
      const seen = new Map<string, number>();
      const OVERLAP_OFFSET_DEG = 0.00012; // ~13m, tight enough to stay accurate

      validContacts.forEach((contact) => {
        const key = `${contact.lat!.toFixed(5)},${contact.lng!.toFixed(5)}`;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);

        let { lat, lng } = { lat: contact.lat!, lng: contact.lng! };
        if (nth > 0) {
          // Deterministic spiral: same input always renders the same way, so
          // markers don't jump between renders.
          const angle = (nth * 2.39996) % (Math.PI * 2); // golden angle, spreads evenly
          const ring = 1 + Math.floor(nth / 8);
          lat += Math.sin(angle) * OVERLAP_OFFSET_DEG * ring;
          // Longitude degrees shrink toward the poles; scale so the visual
          // offset stays circular rather than stretching east-west.
          const latScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
          lng += (Math.cos(angle) * OVERLAP_OFFSET_DEG * ring) / latScale;
        }

        const color = getMarkerColor(contact);
        const marker = new g.maps.Marker({
          position: { lat, lng },
          map,
          title: contact.name || contact.company || "",
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: color,
            fillOpacity: 0.9,
            strokeColor: "#0a0a0a",
            strokeWeight: 2,
          },
        });

        marker.addListener("mouseover", () => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          const mapDiv = containerRef.current;
          if (!mapDiv) return;
          const projection = (map as any).getProjection?.();
          const bounds = (map as any).getBounds?.();
          if (!projection || !bounds) return;
          const ne = projection.fromLatLngToPoint(bounds.getNorthEast());
          const sw = projection.fromLatLngToPoint(bounds.getSouthWest());
          const point = projection.fromLatLngToPoint(marker.getPosition());
          if (!ne || !sw || !point) return;
          const rect = mapDiv.getBoundingClientRect();
          const x = ((point.x - sw.x) / (ne.x - sw.x)) * rect.width;
          const y = ((point.y - ne.y) / (sw.y - ne.y)) * rect.height;
          setHover({ contact, x, y });
        });

        marker.addListener("mouseout", () => {
          hoverTimerRef.current = setTimeout(() => setHover(null), 200);
        });

        marker.addListener("click", () => {
          openLeadRef.current?.(contact.id);
        });

        markersRef.current.push(marker);
      });

      const bounds = new g.maps.LatLngBounds();
      validContacts.forEach((c) => bounds.extend({ lat: c.lat!, lng: c.lng! }));
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
        const listener = g.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom?.() ?? 0) > 14) map.setZoom(14);
        });
        void listener;
      }
    }
  }, [contacts, viewMode, mapsLoaded]);

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted rounded-xl">
        <div className="text-center text-muted-foreground">
          <p className="text-sm font-medium">Failed to load Google Maps</p>
          <p className="text-xs mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!mapsLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted rounded-xl">
        <div className="text-center text-muted-foreground">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm">Loading map…</p>
        </div>
      </div>
    );
  }

  // Contacts with no coordinates can't be plotted. Silently dropping them makes
  // the map look like it lost businesses, so say how many aren't shown.
  const unmappable = contacts.filter((c) => c.lat == null || c.lng == null).length;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0 rounded-xl overflow-hidden" />
      {unmappable > 0 && (
        <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-card/95 border border-border px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          {unmappable} {unmappable === 1 ? "business has" : "businesses have"} no location yet — not shown on the map
        </div>
      )}
      {hover &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: (containerRef.current?.getBoundingClientRect().left ?? 0) + hover.x - 160,
              top: (containerRef.current?.getBoundingClientRect().top ?? 0) + hover.y - 470,
              zIndex: 9999,
              pointerEvents: "auto",
            }}
            onMouseEnter={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            }}
            onMouseLeave={() => {
              hoverTimerRef.current = setTimeout(() => setHover(null), 150);
            }}
          >
            <LeadPinCard
              contact={hover.contact}
              onMouseEnter={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              }}
              onMouseLeave={() => {
                hoverTimerRef.current = setTimeout(() => setHover(null), 150);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
