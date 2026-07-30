import { motion, useReducedMotion } from "framer-motion";
import { Mail, MessageSquare, Send, Phone, Voicemail, Flag } from "lucide-react";

const LANES = [
  { icon: Mail, label: "Email", day: 1, note: "Personalized opener" },
  { icon: MessageSquare, label: "SMS", day: 3, note: "Pattern-interrupt text" },
  { icon: Send, label: "DM", day: 5, note: "LinkedIn + IG hook" },
  { icon: Phone, label: "Call", day: 8, note: "Direct mobile dial" },
  { icon: Voicemail, label: "RVM", day: 10, note: "30-sec voicemail drop" },
];

const TOTAL_DAYS = 14;

export function WeekTimeline() {
  const reduce = useReducedMotion();

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-6 md:p-10">
      {/* Desktop: horizontal */}
      <div className="hidden md:block">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-500 mb-4 pl-24">
          {Array.from({ length: TOTAL_DAYS }, (_, i) => (
            <span key={i} className={i + 1 === 14 ? "r4d-lime font-bold" : ""}>D{i + 1}</span>
          ))}
        </div>
        <div className="space-y-3">
          {LANES.map((lane, i) => (
            <div key={lane.label} className="flex items-center gap-4">
              <div className="w-20 flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-lg border border-white/10 bg-black flex items-center justify-center">
                  <lane.icon className="w-4 h-4 text-white" />
                </div>
                <span className="text-xs font-bold text-zinc-400">{lane.label}</span>
              </div>
              <div className="relative flex-1 h-8">
                <div className="absolute inset-y-1/2 left-0 right-0 h-px bg-white/5" />
                <motion.div
                  className="absolute top-1/2 -translate-y-1/2 group"
                  style={{ left: `${((lane.day - 1) / (TOTAL_DAYS - 1)) * 100}%` }}
                  initial={reduce ? false : { scale: 0, opacity: 0 }}
                  whileInView={reduce ? undefined : { scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.2 + i * 0.25, ease: "backOut" }}
                >
                  <span className="block w-3 h-3 rounded-full r4d-bg-lime r4d-glow-lime-sm -translate-x-1/2" />
                  <div className="absolute left-1/2 -translate-x-1/2 mt-2 text-[10px] whitespace-nowrap text-zinc-500 opacity-0 group-hover:opacity-100 transition">
                    {lane.note}
                  </div>
                </motion.div>
              </div>
            </div>
          ))}
          {/* Day 14 flag */}
          <div className="flex items-center gap-4 pt-3 mt-2 border-t border-white/5">
            <div className="w-20" />
            <div className="relative flex-1 h-8">
              <motion.div
                className="absolute top-1/2 -translate-y-1/2 flex items-center gap-2"
                style={{ left: "100%", transform: "translate(-100%, -50%)" }}
                initial={reduce ? false : { opacity: 0, x: 8 }}
                whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 1.6, duration: 0.4 }}
              >
                <Flag className="w-4 h-4 r4d-lime" />
                <span className="text-xs font-bold r4d-lime">Day 14 — books a meeting</span>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: vertical */}
      <ol className="md:hidden relative pl-6">
        <div className="absolute left-2 top-2 bottom-2 w-px bg-white/10" />
        {LANES.map((lane, i) => (
          <motion.li
            key={lane.label}
            className="relative mb-6 last:mb-0"
            initial={reduce ? false : { opacity: 0, x: -8 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
          >
            <span className="absolute -left-[1.4rem] top-1.5 w-3 h-3 rounded-full r4d-bg-lime r4d-glow-lime-sm" />
            <div className="flex items-center gap-2 text-zinc-300">
              <lane.icon className="w-4 h-4" />
              <span className="font-bold text-sm">Day {lane.day} · {lane.label}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">{lane.note}</p>
          </motion.li>
        ))}
        <li className="relative">
          <span className="absolute -left-[1.4rem] top-1.5 w-3 h-3 rounded-full r4d-bg-lime r4d-glow-lime" />
          <div className="flex items-center gap-2 r4d-lime font-bold text-sm">
            <Flag className="w-4 h-4" /> Day 14 — books a meeting
          </div>
        </li>
      </ol>
    </div>
  );
}
