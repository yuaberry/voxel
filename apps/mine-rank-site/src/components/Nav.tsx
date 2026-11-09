import { useEffect, useState } from "react";
import { PickaxeIcon } from "./Icons";

const LINKS = [
  { href: "#comandos", label: "Comandos" },
  { href: "#progressao", label: "Progressão" },
  { href: "#mundo", label: "Mundo" },
  { href: "#referencia", label: "Referência" },
  { href: "#dedicatoria", label: "Dedicação" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all ${
        scrolled
          ? "border-b border-border/70 bg-background/85 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-16 items-center justify-between gap-4">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <PickaxeIcon className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">
            MINE <span className="brand-text">RANK</span>
          </span>
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a
          href="https://github.com/yuaberry/voxel"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-[1.03]"
        >
          Código no GitHub
        </a>
      </div>
    </header>
  );
}
