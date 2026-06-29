// Assessly design tokens + style helpers, lifted from the shared design.
// Colours are the literal hexes from the design so the React build matches it
// pixel-for-pixel. Helpers mirror the design's diffStyle/optView/stageView.

import type { Difficulty, MCQ, RunStatus } from "@/lib/types";

export const C = {
  bg: "#F4F6F8",
  navy: "#000f47",
  navyDeep: "#000a33",
  navyHover: "#001E52",
  green: "#7AB52C",
  ink: "#3C4858",
  slate: "#46566B",
  slate2: "#5A6B7B",
  muted: "#8593A0",
  faint: "#A6B0BB",
  hair: "#EDF1F4",
  border: "#E9EDF1",
  border2: "#E3E8ED",
  rowLine: "#F0F3F6",
  panel: "#FAFBFD",
  panel2: "#FAFBFC",
  blueChip: "#E1E8F4",
  blueChipBd: "#CFDBEC",
  codeBg: "#1E1F60",
  codeFg: "#C9D6E5",
} as const;

export type DiffStyle = { fg: string; bg: string };

export function diffStyle(d: string): DiffStyle {
  const k = (d || "").toLowerCase();
  if (k === "easy") return { fg: "#4C8A28", bg: "#EEF6E2" };
  if (k === "medium") return { fg: "#B0700C", bg: "#FBF1E0" };
  if (k === "hard") return { fg: "#C0454B", bg: "#FCEBEC" };
  return { fg: "#46566B", bg: "#F0F3F6" };
}

export function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---- generation pipeline (simplified: generate → review) ----
export const STAGES = ["Generating", "Reviewing", "Ready for review", "Finalised"] as const;

/** Map a backend run status (+ client finalised flag) onto the 4-stage pipeline.
 *  Legacy statuses from older runs collapse onto "Reviewing". */
export function stageIndex(status: RunStatus | string, finalised: boolean): number {
  switch (status) {
    case "pending":
    case "generating":
      return 0;
    case "reviewing":
    case "plagchecking":
    case "revamping":
    case "verifying":
      return 1;
    case "done":
      return finalised ? 3 : 2;
    default:
      return 0;
  }
}

export type StageView = {
  label: string;
  fg: string;
  bg: string;
  bd: string;
  deco: string;
  spinning: boolean;
  done: boolean;
};

/** The right-rail process tracker rows for a given stage index. */
export function stageView(stage: number, compact = false): StageView[] {
  return STAGES.map((label, i) => {
    let state: "done" | "active" | "todo";
    const last = STAGES.length - 1;
    if (i < stage) state = "done";
    else if (i === stage) state = stage === last ? "done" : "active";
    else state = "todo";
    let fg = "#A6B0BB",
      bg = "#F4F6F8",
      bd = "#EDF1F4";
    if (state === "done") {
      fg = "#000f47";
      bg = "#E1E8F4";
      bd = "#CDEAE5";
    } else if (state === "active") {
      fg = "#000f47";
      bg = "#fff";
      bd = "#000f47";
    }
    return {
      label,
      fg,
      bg,
      bd,
      deco: "none",
      spinning: state === "active",
      done: !compact && state === "done",
    };
  });
}

export type OptView = {
  text: string;
  letter: string;
  isCode: boolean;
  isText: boolean;
  fg: string;
  bg: string;
  bd: string;
  dotBd: string;
  dotFg: string;
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Render options with the correct one highlighted. `green` switches the accent
 *  from blue (bank/neutral) to green (review/approved). correct = -1 hides it. */
export function optView(opts: string[], correct: number, codeOpts = false, green = false): OptView[] {
  const okFg = green ? "#2E7D32" : "#27288C";
  const okBg = green ? "#EAF6E4" : "#E1E8F4";
  const okBd = green ? "#B6DCA0" : "#C3C4EF";
  const okDot = green ? "#2E7D32" : "#000f47";
  return (opts || []).map((text, i) => {
    const ok = i === correct;
    return {
      text,
      letter: LETTERS[i] ?? "?",
      isCode: !!codeOpts,
      isText: !codeOpts,
      fg: ok ? okFg : "#46566B",
      bg: ok ? okBg : "#FAFBFC",
      bd: ok ? okBd : "#EDF1F4",
      dotBd: ok ? okDot : "#CDD5DD",
      dotFg: ok ? okDot : "#8593A0",
    };
  });
}

/** Relative "x ago" label from an ISO timestamp. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  return `${w} week${w > 1 ? "s" : ""} ago`;
}

export function isCodeMcq(m: MCQ): boolean {
  return m.type === "code" || !!m.snippet;
}

export const DIFFS: Difficulty[] = ["easy", "medium", "hard"];
