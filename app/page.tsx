import Link from "next/link";
import { ArrowRight, Layers, PenLine, Sparkles } from "lucide-react";
import { AppNav } from "@/components/AppNav";

const CARDS = [
  {
    href: "/generate",
    icon: PenLine,
    title: "Generate from scratch",
    desc: "Give a topic and a question type — no samples needed. The AI writes original, source-grounded MCQs and checks its own answers.",
    cta: "Start from a topic",
  },
  {
    href: "/samples",
    icon: Layers,
    title: "Choose from samples",
    desc: "Pick one or more sample sets — even a whole topic at once — and the output matches their format, tone, and difficulty.",
    cta: "Browse sample sets",
  },
];

export default function Home() {
  return (
    <div className="flex h-screen flex-col">
      <AppNav />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[1000px] flex-col items-center justify-center px-6 py-16">
          <div className="mb-10 max-w-xl text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Create original MCQs with AI
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Start from your sample questions, or from just a topic. Every set is grounded on
              real sources, answer-checked, and exported in Mettl-ready format.
            </p>
          </div>

          <div className="grid w-full gap-5 sm:grid-cols-2">
            {CARDS.map(({ href, icon: Icon, title, desc, cta }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col rounded-xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="mb-4 grid size-11 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                  <Icon className="size-5" />
                </span>
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary">
                  {cta}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>

          <Link
            href="/generations"
            className="mt-8 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Sparkles className="size-4" />
            Browse generated questions
          </Link>
        </div>
      </main>
    </div>
  );
}
