import { Check, X } from "lucide-react";

const ROWS = [
  "Decision-maker mobile + personal email",
  "Single sequence across 5 channels",
  "Cold call the decision-maker directly",
  "SMS + DM + RVM in one engine",
  "DNC + TCPA compliance built-in",
  "White-label client sub-accounts",
  "Stop-on-reply across all channels",
  "AI dialer + human power dialer",
  "Hiring / funding / role-change triggers",
  "One bill instead of six",
];

export function ComparisonTable() {
  return (
    <div>
      <div className="overflow-x-auto -mx-6 px-6">
        <div className="min-w-[640px] rounded-2xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] text-xs uppercase tracking-wider font-bold">
            <div className="p-4 text-zinc-400 bg-[#0A0A0A]">Capability</div>
            <div className="p-4 text-center text-zinc-400 bg-[#0A0A0A]">List resellers</div>
            <div className="p-4 text-center text-zinc-400 bg-[#0A0A0A]">Cold-call agencies</div>
            <div className="p-4 text-center text-black r4d-bg-lime border-x-2 border-[#C6F432]">the engine</div>
          </div>
          {ROWS.map((row, i) => (
            <div
              key={row}
              className={`grid grid-cols-[1.6fr_1fr_1fr_1fr] text-sm border-t border-white/5 ${
                i % 2 === 0 ? "bg-black" : "bg-[#070707]"
              }`}
            >
              <div className="p-4 text-zinc-300">{row}</div>
              <div className="p-4 flex items-center justify-center text-zinc-600"><X className="w-4 h-4" /></div>
              <div className="p-4 flex items-center justify-center text-zinc-600"><X className="w-4 h-4" /></div>
              <div className="p-4 flex items-center justify-center r4d-lime border-x-2 border-[#C6F432] bg-[#C6F432]/5">
                <Check className="w-5 h-5" strokeWidth={3} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cost strip */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-[#0A0A0A] p-6 md:p-7 text-sm leading-relaxed">
        <p className="text-zinc-400">
          <span className="text-zinc-500 font-semibold uppercase text-xs tracking-widest block mb-2">Your current stack</span>
          <span className="line-through decoration-zinc-700">
            A list tool ($99) + a sender ($94) + a dialer ($120) + a skip-trace tool ($147) + a scraper ($69) + a VA ($800)
          </span>{" "}
          <span className="text-white font-bold whitespace-nowrap">≈ $1,300+/mo</span>
          <span className="text-zinc-500"> and six logins.</span>
        </p>
        <p className="mt-3 r4d-lime font-bold text-base">
          the engine starts at $149/mo and one login.
        </p>
      </div>
    </div>
  );
}
