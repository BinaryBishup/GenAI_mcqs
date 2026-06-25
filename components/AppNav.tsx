"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Cpu, Layers, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/generate", label: "From scratch", icon: PenLine },
  { href: "/samples", label: "Samples", icon: Layers },
  { href: "/generations", label: "Generated", icon: Sparkles },
];

export interface AppNavProps {
  /** Contextual back control (detail/run views). Rendered on the LEFT. */
  back?: { href?: string; onClick?: () => void; label?: string; disabled?: boolean };
  /** Contextual title shown next to Back (e.g. the run topic). */
  title?: string;
  subtitle?: React.ReactNode;
  /** Right-aligned contextual actions (e.g. a Download menu). */
  actions?: React.ReactNode;
}

/**
 * The one fixed top bar for the whole app. Brand → home on the left, primary
 * nav links with active highlight, and — in detail/run contexts — a Back button
 * (always top-LEFT) plus a title and right-aligned actions. Used in place of the
 * old per-page headers so navigation is consistent and pinned across pages.
 */
export function AppNav({ back, title, subtitle, actions }: AppNavProps) {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-blue-950/50 bg-blue-950 text-white">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Home">
          <span className="grid size-8 place-items-center rounded-md bg-white/10 ring-1 ring-white/20">
            <Cpu className="size-4" />
          </span>
          <span className="hidden text-sm font-semibold sm:inline">MCQ Gen AI</span>
        </Link>

        {back ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-6 w-px bg-white/15" />
            {back.href ? (
              <Link href={back.href}>
                <Button variant="ghost" size="sm" className="text-white/90 hover:bg-white/10 hover:text-white">
                  <ArrowLeft />
                  {back.label ?? "Back"}
                </Button>
              </Link>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={back.disabled}
                onClick={back.onClick}
                className="text-white/90 hover:bg-white/10 hover:text-white disabled:text-white/40"
              >
                <ArrowLeft />
                {back.label ?? "Back"}
              </Button>
            )}
            {title && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{title}</p>
                {subtitle && <p className="mt-0.5 truncate text-[11px] text-white/60">{subtitle}</p>}
              </div>
            )}
          </div>
        ) : (
          <nav className="flex items-center gap-1">
            <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" />
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link key={href} href={href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "gap-1.5 text-white/80 hover:bg-white/10 hover:text-white aria-expanded:bg-white/10",
                      active && "bg-white/10 text-white",
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="hidden md:inline">{label}</span>
                  </Button>
                </Link>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}
