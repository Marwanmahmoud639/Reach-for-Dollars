import { lazy, Suspense, useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

// Heavy Three.js + drei + 1MB GLB — never load on mobile/low-power devices.
const BubbleBackground = lazy(() =>
  import("./BubbleBackground").then((m) => ({ default: m.BubbleBackground })),
);

function useCanRender3D(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      setOk(false);
      return;
    }
    try {
      // Desktop viewport
      const wideEnough = window.matchMedia("(min-width: 1024px)").matches;
      // Fine pointer (mouse) — filters phones/most tablets
      const finePointer = window.matchMedia("(pointer: fine)").matches;
      // Respect reduced motion
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!wideEnough || !finePointer || reduced) {
        setOk(false);
        return;
      }
      // Hardware WebGL check — software fallback (swiftshader) causes GPU stalls
      const canvas = document.createElement("canvas");
      const gl =
        (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
        (canvas.getContext("webgl") as WebGLRenderingContext | null);
      if (!gl) {
        setOk(false);
        return;
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "")
        : "";
      const isSoftware = /swiftshader|software|llvmpipe|microsoft basic render/i.test(
        renderer,
      );
      setOk(!isSoftware);
    } catch {
      setOk(false);
    }
  }, []);
  return ok;
}

function CssFallback() {
  const { resolved } = useTheme();
  const isLight = resolved === "light";
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background: isLight
          ? "radial-gradient(ellipse at center, oklch(0.92 0.08 130 / 0.45) 0%, oklch(0.97 0.02 80 / 0.45) 55%, oklch(0.95 0.025 80 / 0.85) 100%)"
          : "radial-gradient(ellipse at center, oklch(0.55 0.18 135 / 0.18) 0%, hsl(var(--background) / 0.4) 55%, hsl(var(--background) / 0.85) 100%)",
      }}
    />
  );
}

export function BubbleBackgroundLazy() {
  const canRender3D = useCanRender3D();
  if (canRender3D === null) return null; // wait for capability check
  if (!canRender3D) return <CssFallback />;
  return (
    <Suspense fallback={<CssFallback />}>
      <BubbleBackground />
    </Suspense>
  );
}
