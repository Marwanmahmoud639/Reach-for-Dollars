import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

const STEPS = [
  { n: 1, title: "Pick your engine", body: "Secure checkout — card or balance." },
  { n: 2, title: "Claim your access", body: "You're sent to /signup. Enter the email you paid with." },
  { n: 3, title: "We approve you", body: "Manual approval — no bots. Get a one-time 6-digit code by email." },
  { n: 4, title: "Activate & launch", body: "Enter the code, set a password — sub-accounts and sequences provision in minutes." },
];

export function AccessTracker() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 60%"] });
  const widthPct = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const heightPct = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative">
      {/* Desktop horizontal */}
      <div className="hidden md:block relative">
        <div className="absolute top-6 left-[6%] right-[6%] h-px bg-white/10" />
        <motion.div
          className="absolute top-6 left-[6%] h-px r4d-bg-lime"
          style={{ width: reduce ? "100%" : widthPct, maxWidth: "88%" }}
        />
        <div className="grid grid-cols-4 gap-6 relative">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col items-center text-center px-2">
              <div className="w-12 h-12 rounded-full r4d-bg-lime text-black font-black text-lg flex items-center justify-center r4d-glow-lime-sm relative z-10 mb-4">
                {s.n}
              </div>
              <h4 className="font-bold text-white mb-1">{s.title}</h4>
              <p className="text-sm text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile vertical */}
      <div className="md:hidden relative pl-14">
        <div className="absolute left-6 top-2 bottom-2 w-px bg-white/10" />
        <motion.div
          className="absolute left-6 top-2 w-px r4d-bg-lime"
          style={{ height: reduce ? "100%" : heightPct }}
        />
        <ol className="space-y-8">
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span className="absolute -left-14 w-12 h-12 rounded-full r4d-bg-lime text-black font-black flex items-center justify-center">
                {s.n}
              </span>
              <h4 className="font-bold text-white mb-1">{s.title}</h4>
              <p className="text-sm text-zinc-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
