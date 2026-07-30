// Fixed grain overlay across the page. ~4% opacity, subtle animated jitter.
export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] mix-blend-overlay"
      style={{
        opacity: 0.04,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        backgroundSize: "200px 200px",
        animation: "grainShift 1.4s steps(4) infinite",
      }}
    >
      <style>{`@keyframes grainShift{0%{transform:translate(0,0)}25%{transform:translate(-6px,4px)}50%{transform:translate(4px,-6px)}75%{transform:translate(-3px,-3px)}100%{transform:translate(0,0)}}`}</style>
    </div>
  );
}
