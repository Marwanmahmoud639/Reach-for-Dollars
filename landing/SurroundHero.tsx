import { motion, useReducedMotion } from "framer-motion";
import { Mail, MessageSquare, Send, Phone, Voicemail, User } from "lucide-react";

const CHANNELS = [
  { icon: Mail, label: "Email", angle: -90 },
  { icon: MessageSquare, label: "SMS", angle: -18 },
  { icon: Send, label: "DM", angle: 54 },
  { icon: Phone, label: "Cold call", angle: 126 },
  { icon: Voicemail, label: "RVM", angle: 198 },
];

export function SurroundHero() {
  const reduce = useReducedMotion();
  const radius = 130;

  return (
    <div className="relative w-full aspect-square max-w-[460px] mx-auto select-none">
      {/* Faint orbit ring */}
      <div className="absolute inset-[18%] rounded-full border border-white/5" />
      <div className="absolute inset-[8%] rounded-full border border-white/[0.03]" />

      {/* Center node */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-full r4d-bg-lime blur-2xl opacity-25" />
          <div className="relative w-28 h-28 rounded-full bg-black border-2 border-[#C6F432] flex flex-col items-center justify-center r4d-glow-lime">
            <User className="w-6 h-6 r4d-lime mb-1" strokeWidth={2} />
            <div className="text-[10px] uppercase tracking-widest text-white/80 font-bold">Decision</div>
            <div className="text-[10px] uppercase tracking-widest text-white/80 font-bold">Maker</div>
          </div>
        </div>
      </div>

      {/* Channel chips + pulses */}
      {CHANNELS.map((c, i) => {
        const rad = (c.angle * Math.PI) / 180;
        const x = Math.cos(rad) * radius;
        const y = Math.sin(rad) * radius;
        return (
          <div
            key={c.label}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          >
            {/* Icon chip is the anchor — sits exactly on the radius */}
            <div className="relative w-14 h-14 rounded-2xl bg-zinc-950 border border-white/10 flex items-center justify-center backdrop-blur-sm">
              <c.icon className="w-5 h-5 text-white" strokeWidth={2} />
              {/* Label floats below without pulling the anchor off-radius */}
              <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {c.label}
              </span>
            </div>
            {/* Pulse line from chip to center */}
            {!reduce && (
              <motion.span
                className="absolute top-1/2 left-1/2 origin-top block rounded-full r4d-bg-lime"
                style={{
                  width: 2,
                  height: radius - 28,
                  rotate: `${c.angle + 90}deg`,
                  transformOrigin: "top center",
                }}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: [0, 0.9, 0], scaleY: [0, 1, 1] }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  repeatDelay: 5,
                  delay: i * 1.1,
                  ease: "easeOut",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
