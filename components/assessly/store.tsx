"use client";

// The Assessly workspace is a single-page shell whose navigation, data and
// cross-screen actions live in one context (mirroring the design's central
// component state, but backed by the real backend). Heavy per-screen state
// (the review board, the generate wizard) lives inside those components; this
// store is the shared spine: auth, navigation, the runs list, the sample
// catalog, and the client-only "finalised / shifted to admin" flags (which the
// backend has no column for).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  fetchCatalog,
  fetchPastRuns,
  startGeneration,
} from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { GenerateRequest, PastRunSummary, SampleCatalogItem, Team } from "@/lib/types";

export interface AuthUser {
  name: string;
  email: string;
  team: Team;
}

function userFromSession(session: Session | null): AuthUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as { full_name?: string; team?: Team };
  return {
    name: meta.full_name || u.email?.split("@")[0] || "Member",
    email: u.email ?? "",
    team: (meta.team as Team) ?? "HACK",
  };
}

export type Screen =
  | "login"
  | "dashboard"
  | "ongoing"
  | "generated"
  | "finalised"
  | "banks"
  | "bank"
  | "review";

const LS_FINAL = "assessly.finalised";
const LS_PUB = "assessly.published";

function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}
function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore quota / private mode */
  }
}

interface Ctx {
  // auth
  loggedIn: boolean;
  authReady: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => void;

  // navigation
  screen: Screen;
  go: (s: Screen) => void;
  bankNav: string[];
  setBankNav: (path: string[]) => void;
  openBankFolder: (seg: string) => void;
  bankFile: string | null;
  openBank: (filename: string) => void;
  reviewRunId: string | null;
  openReview: (runId: string) => void;
  reviewBar: ReviewBar | null;
  setReviewBar: (b: ReviewBar | null) => void;

  // data
  runs: PastRunSummary[];
  runsLoading: boolean;
  refreshRuns: () => Promise<void>;
  catalog: SampleCatalogItem[];
  catalogLoading: boolean;
  refreshCatalog: () => Promise<void>;

  // client-only lifecycle flags
  finalisedIds: Set<string>;
  publishedIds: Set<string>;
  markFinalised: (id: string) => void;
  markPublished: (id: string) => void;

  // modals
  genOpen: boolean;
  setGenOpen: (v: boolean) => void;
  scratchOpen: boolean;
  setScratchOpen: (v: boolean) => void;
  userMenuOpen: boolean;
  setUserMenuOpen: (v: boolean) => void;

  // actions
  startRun: (req: GenerateRequest) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

export interface ReviewBar {
  title: string;
  difficulty: string;
  approved: number;
  onRegenerate: () => void;
  onFinalise: () => void;
  onExport: () => void;
  onExportPdf: (withAnswers: boolean) => void;
}

const AssesslyCtx = createContext<Ctx | null>(null);

export function useAssessly(): Ctx {
  const ctx = useContext(AssesslyCtx);
  if (!ctx) throw new Error("useAssessly must be used inside <AssesslyProvider>");
  return ctx;
}

const ONGOING_STATUSES = new Set(["pending", "generating", "reviewing", "plagchecking", "revamping", "verifying"]);

export function AssesslyProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const loggedIn = !!user;
  const [screen, setScreen] = useState<Screen>("login");
  const [bankNav, setBankNavState] = useState<string[]>([]);
  const [bankFile, setBankFile] = useState<string | null>(null);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [reviewBar, setReviewBar] = useState<ReviewBar | null>(null);

  const [runs, setRuns] = useState<PastRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [catalog, setCatalog] = useState<SampleCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [finalisedIds, setFinalisedIds] = useState<Set<string>>(new Set());
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  const [genOpen, setGenOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeStreams = useRef<Array<() => void>>([]);

  // hydrate client-only flags
  useEffect(() => {
    setFinalisedIds(loadSet(LS_FINAL));
    setPublishedIds(loadSet(LS_PUB));
  }, []);

  // Supabase session: restore on mount and keep in sync with auth changes.
  useEffect(() => {
    const supa = supabaseBrowser();
    supa.auth.getSession().then(({ data }) => {
      const u = userFromSession(data.session);
      setUser(u);
      setScreen(u ? "dashboard" : "login");
      setAuthReady(true);
    });
    const { data: sub } = supa.auth.onAuthStateChange((_event, session) => {
      const u = userFromSession(session);
      setUser(u);
      setScreen((prev) => (u ? (prev === "login" ? "dashboard" : prev) : "login"));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const { runs } = await fetchPastRuns();
      setRuns(runs);
    } catch {
      /* transient; next poll retries */
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const { items } = await fetchCatalog();
      setCatalog(items);
    } catch {
      /* ignore */
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  // initial + polling loads once authenticated
  useEffect(() => {
    if (!loggedIn) return;
    refreshRuns();
    refreshCatalog();
    const iv = setInterval(() => {
      // keep the runs list live so the pipeline animates as the backend works
      refreshRuns();
    }, 4000);
    return () => clearInterval(iv);
  }, [loggedIn, refreshRuns, refreshCatalog]);

  useEffect(() => {
    return () => {
      activeStreams.current.forEach((cancel) => cancel());
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const go = useCallback((s: Screen) => {
    setScreen(s);
    setUserMenuOpen(false);
  }, []);

  const setBankNav = useCallback((path: string[]) => {
    setBankNavState(path);
    setScreen("banks");
  }, []);
  const openBankFolder = useCallback((seg: string) => {
    setBankNavState((p) => [...p, seg]);
  }, []);
  const openBank = useCallback((filename: string) => {
    setBankFile(filename);
    setScreen("bank");
  }, []);
  const openReview = useCallback((runId: string) => {
    setReviewRunId(runId);
    setReviewBar(null);
    setScreen("review");
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: error.message };
    // onAuthStateChange sets the user + navigates to the dashboard.
    return {};
  }, []);
  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
    setUser(null);
    setRuns([]);
    setCatalog([]);
    setScreen("login");
    setUserMenuOpen(false);
  }, []);

  const markFinalised = useCallback((id: string) => {
    setFinalisedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(LS_FINAL, next);
      return next;
    });
  }, []);
  const markPublished = useCallback((id: string) => {
    setPublishedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(LS_PUB, next);
      return next;
    });
  }, []);

  const startRun = useCallback(
    (req: GenerateRequest) => {
      const cancel = startGeneration(
        req,
        () => {
          /* per-event progress is observed via the polled runs list + review screen */
        },
        () => {
          activeStreams.current = activeStreams.current.filter((c) => c !== cancel);
          refreshRuns();
        },
        () => {
          activeStreams.current = activeStreams.current.filter((c) => c !== cancel);
          refreshRuns();
        },
      );
      activeStreams.current.push(cancel);
      // optimistic: pull the freshly-created run row in shortly
      setTimeout(refreshRuns, 800);
      setGenOpen(false);
      setScratchOpen(false);
      setScreen("ongoing");
    },
    [refreshRuns],
  );

  const value: Ctx = {
    loggedIn,
    authReady,
    user,
    signIn,
    signOut,
    screen,
    go,
    bankNav,
    setBankNav,
    openBankFolder,
    bankFile,
    openBank,
    reviewRunId,
    openReview,
    reviewBar,
    setReviewBar,
    runs,
    runsLoading,
    refreshRuns,
    catalog,
    catalogLoading,
    refreshCatalog,
    finalisedIds,
    publishedIds,
    markFinalised,
    markPublished,
    genOpen,
    setGenOpen,
    scratchOpen,
    setScratchOpen,
    userMenuOpen,
    setUserMenuOpen,
    startRun,
    toast,
    toastMsg,
  };

  return <AssesslyCtx.Provider value={value}>{children}</AssesslyCtx.Provider>;
}

// ---- shared run-bucket selectors (kept here so every screen agrees) ----

export function isOngoing(r: PastRunSummary): boolean {
  return ONGOING_STATUSES.has(r.status);
}
export function runSourceLabel(r: PastRunSummary): string {
  if (r.sample_file_ids && r.sample_file_ids.length) {
    return r.sample_file_ids.length === 1
      ? r.sample_file_ids[0]
      : `${r.sample_file_ids[0]} +${r.sample_file_ids.length - 1} more`;
  }
  return "From scratch";
}
export function runModeLabel(r: PastRunSummary): string {
  return r.sample_file_ids && r.sample_file_ids.length ? "From samples" : "From scratch";
}
