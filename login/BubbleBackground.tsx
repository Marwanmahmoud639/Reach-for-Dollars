import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment } from "@react-three/drei";
import type { Group } from "three";
import { useTheme } from "@/lib/theme";

const MODEL_URL = "/models/abstract_design.glb";

function Bubble() {
  const ref = useRef<Group>(null);
  const { scene } = useGLTF(MODEL_URL);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.15;
      ref.current.rotation.x += delta * 0.04;
    }
  });
  return (
    <group ref={ref} scale={2.2}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

export function BubbleBackground() {
  const [mounted, setMounted] = useState(false);
  const { resolved } = useTheme();
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isLight = resolved === "light";

  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={isLight ? 0.7 : 0.4} />
        <directionalLight position={[5, 5, 5]} intensity={isLight ? 1.1 : 0.8} />
        <pointLight
          position={[-4, -2, 3]}
          intensity={isLight ? 1.6 : 1.2}
          color={isLight ? "#7ba814" : "#a3e635"}
        />
        <Suspense fallback={null}>
          <Bubble />
          <Environment preset={isLight ? "sunset" : "city"} />
        </Suspense>
      </Canvas>
      {/* Vignette so the card stays legible; tinted to match theme */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? "radial-gradient(ellipse at center, transparent 0%, oklch(0.97 0.02 80 / 0.45) 55%, oklch(0.95 0.025 80 / 0.85) 100%)"
            : "radial-gradient(ellipse at center, transparent 0%, hsl(var(--background) / 0.4) 55%, hsl(var(--background) / 0.8) 100%)",
        }}
      />
    </div>
  );
}
