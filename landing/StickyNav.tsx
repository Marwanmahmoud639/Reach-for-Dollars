import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
const r4dLogo = { url: "https://res.cloudinary.com/dmn6vkxiw/image/upload/v1784670532/favicon_ljfjh2.ico" };

const LINKS = [
  { href: "#sequence", label: "The Sequence" },
  { href: "#engine", label: "Engine" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function StickyNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled ? "bg-black/80 backdrop-blur-xl border-b border-white/5" : "bg-transparent"
        }`}
      >
        <div className={`max-w-7xl mx-auto px-6 flex items-center justify-between transition-all ${scrolled ? "h-14" : "h-20"}`}>
          <Link to="/" className="flex items-center gap-2">
            <img src={r4dLogo.url} alt="The engine" className="w-8 h-8 rounded-lg object-contain" />
            <span className="font-black tracking-tight text-lg text-white">the engine</span>
          </Link>

          <nav
            className={`hidden md:flex items-center gap-8 text-sm text-zinc-400 transition-opacity ${
              scrolled ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-white transition">{l.label}</a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="text-sm text-zinc-300 hover:text-white transition px-3 py-2">
              Sign in
            </Link>
            <a
              href="#pricing"
              className="text-sm font-bold r4d-bg-lime hover:opacity-90 text-black px-4 py-2 rounded-lg inline-flex items-center gap-1.5"
            >
              Get Access <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>

          <button
            onClick={() => setOpen(true)}
            className="md:hidden w-10 h-10 rounded-lg r4d-bg-lime text-black flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black md:hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-20">
            <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2">
              <img src={r4dLogo.url} alt="The engine" className="w-8 h-8 rounded-lg object-contain" />
              <span className="font-black text-lg text-white">the engine</span>
            </Link>
            <button onClick={() => setOpen(false)} className="w-10 h-10 rounded-lg border border-white/10 text-white flex items-center justify-center" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-3xl font-black text-white hover:r4d-lime transition"
              >
                {l.label}
              </a>
            ))}
            <Link to="/login" onClick={() => setOpen(false)} className="text-zinc-400 text-lg">
              Sign in
            </Link>
          </nav>
          <div className="p-6">
            <a
              href="#pricing"
              onClick={() => setOpen(false)}
              className="w-full inline-flex items-center justify-center gap-2 r4d-bg-lime text-black font-bold py-4 rounded-xl"
            >
              Get Access <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}
    </>
  );
}
