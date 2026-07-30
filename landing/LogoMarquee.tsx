const LOGOS = [
  "One 6-person B2B agency", "Outbound Republic", "Velocity B2B",
  "Apex Partners", "Signal Studio", "Cold Iron Co.",
];

export function LogoMarquee() {
  return (
    <>
      {/* Desktop: static row */}
      <div className="hidden md:flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-50">
        {LOGOS.map((n) => (
          <span key={n} className="text-zinc-400 font-bold tracking-tight text-lg">{n}</span>
        ))}
      </div>

      {/* Mobile: auto-scroll marquee */}
      <div className="md:hidden overflow-hidden mask-fade">
        <div className="flex gap-12 whitespace-nowrap" style={{ animation: "logoScroll 28s linear infinite" }}>
          {[...LOGOS, ...LOGOS].map((n, i) => (
            <span key={`${n}-${i}`} className="text-zinc-400 font-bold tracking-tight text-base opacity-60">
              {n}
            </span>
          ))}
        </div>
        <style>{`
          @keyframes logoScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
          .mask-fade { mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
        `}</style>
      </div>
    </>
  );
}
