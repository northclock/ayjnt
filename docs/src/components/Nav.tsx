import Link from "next/link";
import { Logo } from "./Logo";
import { GitBranch, Package } from "lucide-react";

const LINKS = [
  { href: "/examples", label: "Examples" },
  { href: "/docs", label: "Docs" },
];

const EXTERNAL = [
  {
    href: "https://github.com/northclock/ayjnt",
    label: "GitHub",
    icon: GitBranch,
  },
  {
    href: "https://www.npmjs.com/package/ayjnt",
    label: "npm",
    icon: Package,
  },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--ink)] bg-[var(--paper)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--paper)]/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="link-underline">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-3 py-1.5 font-mono text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              {l.label}
            </Link>
          ))}
          <span className="mx-2 h-5 w-px bg-[var(--rule-strong)]" />
          {EXTERNAL.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              aria-label={l.label}
              className="inline-flex h-8 w-8 items-center justify-center text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              <l.icon className="h-4 w-4" />
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
