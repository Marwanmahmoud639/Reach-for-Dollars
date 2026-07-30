import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, TrendingUp } from "lucide-react";

const R4D_REPLY = 8; // 8% — the midpoint of 7-9% benchmark

export function MathCalculator() {
  const [prospects, setProspects] = useState(1000);
  const [reply, setReply] = useState(1.5);
  const [meetingRate, setMeetingRate] = useState(30);
  const [clientValue, setClientValue] = useState(4000);

  const result = useMemo(() => {
    const meetingsNow = Math.round((prospects * (reply / 100)) * (meetingRate / 100));
    const meetingsR4D = Math.round((prospects * (R4D_REPLY / 100)) * (meetingRate / 100));
    const gap = Math.max(0, meetingsR4D - meetingsNow);
    // Assume 1 in 4 meetings closes — conservative.
    const closedNow = meetingsNow / 4;
    const closedR4D = meetingsR4D / 4;
    const dollarGap = Math.round((closedR4D - closedNow) * clientValue);
    return { meetingsNow, meetingsR4D, gap, dollarGap };
  }, [prospects, reply, meetingRate, clientValue]);

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-6 md:p-10">
      <div className="grid lg:grid-cols-2 gap-10">
        {/* Inputs */}
        <div className="space-y-6">
          <NumberSlider label="Prospects you work per month" value={prospects} min={100} max={10000} step={100} onChange={setProspects} format={(v) => v.toLocaleString()} />
          <NumberSlider label="Your current reply rate" value={reply} min={0.5} max={6} step={0.1} onChange={setReply} format={(v) => `${v.toFixed(1)}%`} />
          <NumberSlider label="Reply → meeting rate" value={meetingRate} min={10} max={60} step={1} onChange={setMeetingRate} format={(v) => `${v}%`} />
          <NumberSlider label="Avg. value of a closed client" value={clientValue} min={500} max={25000} step={250} onChange={setClientValue} format={(v) => `$${v.toLocaleString()}`} />
        </div>

        {/* Outputs */}
        <div className="rounded-2xl border border-white/10 bg-black p-6 md:p-8 flex flex-col">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Your monthly gap</div>
          <motion.div
            key={result.dollarGap}
            initial={{ opacity: 0.5, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="font-black text-4xl md:text-5xl text-white tracking-tight mb-1"
          >
            ~<span className="r4d-lime">${result.dollarGap.toLocaleString()}</span>/mo
          </motion.div>
          <p className="text-sm text-zinc-400 mb-6">
            You're leaving <span className="text-white font-semibold">~${result.dollarGap.toLocaleString()}/mo</span> on the table by running one channel.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <Stat label="Meetings now" value={result.meetingsNow} />
            <Stat label="Meetings on the engine" value={result.meetingsR4D} accent />
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
            <TrendingUp className="w-3.5 h-3.5" />
            Assumes the engine's 5-channel sequence lifts reply rate to ~{R4D_REPLY}%.
          </div>

          <a
            href="#pricing"
            className="mt-auto inline-flex items-center justify-center gap-2 r4d-bg-lime hover:opacity-90 text-black font-bold py-3.5 rounded-xl"
          >
            Close the gap → Get Access <ArrowRight className="w-4 h-4" />
          </a>
          <p className="text-[11px] text-zinc-600 mt-3 text-center">
            Illustrative — based on multi-channel reply benchmarks, not a guarantee.
          </p>
        </div>
      </div>
    </div>
  );
}

function NumberSlider({
  label, value, min, max, step, onChange, format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-zinc-300">{label}</label>
        <span className="font-mono text-sm r4d-lime font-bold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#C6F432] h-2 cursor-pointer"
      />
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-[#C6F432]/40 bg-[#C6F432]/5" : "border-white/10 bg-white/[0.02]"}`}>
      <div className={`text-2xl font-black ${accent ? "r4d-lime" : "text-white"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 mt-1">{label}</div>
    </div>
  );
}
