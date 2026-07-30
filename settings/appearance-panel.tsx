import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTheme, PALETTES, type Palette } from "@/lib/theme";
import { Palette as PaletteIcon, Sun, Moon, Monitor, Check } from "lucide-react";

export function AppearancePanel() {
  const { theme, setTheme, palette, setPalette } = useTheme();

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center gap-2 font-semibold">
        <PaletteIcon className="w-4 h-4" /> Appearance
      </div>

      <div className="space-y-2">
        <Label>Mode</Label>
        <div className="flex gap-2">
          {([
            { key: "light", label: "Light", icon: Sun },
            { key: "dark", label: "Dark", icon: Moon },
            { key: "system", label: "System", icon: Monitor },
          ] as const).map(({ key, label, icon: Icon }) => (
            <Button
              key={key}
              variant={theme === key ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme(key)}
            >
              <Icon className="w-3.5 h-3.5 mr-1.5" /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <Label>Colour palette</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Applies to both light and dark mode. Saved on this device.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PALETTES.map((p) => {
            const active = palette === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPalette(p.key as Palette)}
                className={[
                  "text-left rounded-xl border p-4 transition-colors",
                  active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{p.label}</span>
                  {active
                    ? <Badge className="text-[10px]"><Check className="w-3 h-3 mr-1" /> Active</Badge>
                    : p.key === "money" && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                <div className="flex gap-1.5 mt-3">
                  {p.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="w-7 h-7 rounded-md border border-border/60"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
