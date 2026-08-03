"use client";

// The SmartCoGen workspace is a single-page shell whose navigation, data and
// cross-screen actions live in one context (mirroring the design's central
// component state, but backed by the real backend). Heavy per-screen state
// (the review board, the generate wizard) lives inside those components; this
// store is the shared spine: auth, navigation, the runs list, the sample
// catalog, and the client-only "finalised / shifted to admin" flags (which the
// backend has no column for).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCatalog,
  fetchPastRuns,
  fetchTags,
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  addTagItem,
  removeTagItem,
  startGeneration,
  finaliseRun,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  type AuthUserDTO,
  LS_VIEW_TEAM,
} from "@/lib/api";
import { TEAMS } from "@/lib/types";
import type { GenerateRequest, PastRunSummary, SampleCatalogItem, Tag, TagItemType, Team, TeamMeta } from "@/lib/types";

export interface AuthUser {
  name: string;
  email: string;
  /** Primary team from auth metadata — "ALL" marks the everything-visible group. */
  team: TeamMeta;
  /** Teams this user may view; >1 entry puts the team switcher in the topbar. */
  teams: Team[];
}

/** Narrow the /api/auth payload to the shape the UI uses. The server has already
 *  validated the grants; this only guards against an empty list. */
function toAuthUser(dto: AuthUserDTO | null): AuthUser | null {
  if (!dto) return null;
  const teams = dto.teams.filter((t): t is Team => TEAMS.includes(t as Team));
  return {
    name: dto.name || dto.email.split("@")[0] || "Member",
    email: dto.email,
    team: (dto.team as TeamMeta) ?? "HACK",
    teams: teams.length ? teams : ["HACK"],
  };
}

/** Pick the view team for a fresh session: last choice if still permitted, else the first grant.
 *  Written to localStorage immediately so authHeader() scopes the very first fetches. */
function initialViewTeam(u: AuthUser | null): Team | null {
  if (!u) return null;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LS_VIEW_TEAM);
  } catch {
    /* private mode */
  }
  const team = u.teams.includes(stored as Team) ? (stored as Team) : u.teams[0];
  try {
    localStorage.setItem(LS_VIEW_TEAM, team);
  } catch {
    /* ignore */
  }
  return team;
}

export type Screen =
  | "login"
  | "dashboard"
  | "ongoing"
  | "generated"
  | "finalised"
  | "finalisedRun"
  | "banks"
  | "bank"
  | "review"
  | "tag"
  | "scratch"
  | "faqs";

// ---- URL routing ---------------------------------------------------------
// Every screen has a real path so views are shareable/bookmarkable and the
// browser back button works. The app is served by an optional catch-all route
// (app/[[...slug]]/page.tsx); this maps store state <-> pathname.

interface Route {
  screen: Screen;
  bankNav: string[];
  bankFile: string | null;
  reviewRunId: string | null;
  finalRunId: string | null;
  activeTagId: string | null;
}

const EMPTY_ROUTE: Omit<Route, "screen"> = { bankNav: [], bankFile: null, reviewRunId: null, finalRunId: null, activeTagId: null };

/** A screen plus only the params it needs — the rest default to empty. */
export type RouteInput = { screen: Screen } & Partial<Omit<Route, "screen">>;

export function fullRoute(r: RouteInput): Route {
  return { ...EMPTY_ROUTE, ...r };
}

export function pathForRoute(input: RouteInput): string {
  const r = fullRoute(input);
  switch (r.screen) {
    case "ongoing": return "/ongoing";
    case "generated": return "/generated";
    case "finalised": return "/finalised";
    case "finalisedRun": return `/finalised/${encodeURIComponent(r.finalRunId ?? "")}`;
    case "banks": return r.bankNav.length ? `/banks/${r.bankNav.map(encodeURIComponent).join("/")}` : "/banks";
    case "bank": return `/bank/${encodeURIComponent(r.bankFile ?? "")}`;
    case "review": return `/generation/${encodeURIComponent(r.reviewRunId ?? "")}`;
    case "tag": return `/tag/${encodeURIComponent(r.activeTagId ?? "")}`;
    case "scratch": return "/create";
    case "faqs": return "/faqs";
    default: return "/";
  }
}

export function parsePath(pathname: string): Route {
  const segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const head = segs[0] ?? "";
  if (head === "finalised" && segs[1]) return fullRoute({ screen: "finalisedRun", finalRunId: segs[1] });
  if (head === "ongoing" || head === "generated" || head === "finalised") return fullRoute({ screen: head });
  if (head === "banks") return fullRoute({ screen: "banks", bankNav: segs.slice(1) });
  if (head === "bank" && segs[1]) return fullRoute({ screen: "bank", bankFile: segs[1] });
  if (head === "generation" && segs[1]) return fullRoute({ screen: "review", reviewRunId: segs[1] });
  if (head === "tag" && segs[1]) return fullRoute({ screen: "tag", activeTagId: segs[1] });
  if (head === "create") return fullRoute({ screen: "scratch" });
  if (head === "faqs") return fullRoute({ screen: "faqs" });
  return fullRoute({ screen: "dashboard" });
}

const LS_FINAL = "smartcogen.finalised";
const LS_PUB = "smartcogen.published";

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
  /** Team whose data is currently shown; switchable when the user has >1 grant. */
  viewTeam: Team | null;
  setViewTeam: (t: Team) => void;

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
  /** Run shown on the read-only finalised-bank page (/finalised/<id>). */
  finalRunId: string | null;
  openFinalised: (runId: string) => void;
  reviewBar: ReviewBar | null;
  setReviewBar: (b: ReviewBar | null) => void;
  /** Tag currently being viewed (drives the "tag" screen filter). */
  activeTagId: string | null;
  openTag: (tagId: string) => void;

  // data
  runs: PastRunSummary[];
  runsLoading: boolean;
  refreshRuns: () => Promise<void>;
  catalog: SampleCatalogItem[];
  catalogLoading: boolean;
  refreshCatalog: () => Promise<void>;
  tags: Tag[];
  refreshTags: () => Promise<void>;
  createTag: (name: string, color: string) => Promise<{ tag?: Tag; error?: string }>;
  deleteTag: (id: string) => Promise<void>;
  /** Add/remove a run or bank to a tag; optimistic, then persisted. */
  toggleTagItem: (tagId: string, itemType: TagItemType, itemId: string, add: boolean) => Promise<void>;

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
}

const SmartCoGenCtx = createContext<Ctx | null>(null);

export function useSmartCoGen(): Ctx {
  const ctx = useContext(SmartCoGenCtx);
  if (!ctx) throw new Error("useSmartCoGen must be used inside <SmartCoGenProvider>");
  return ctx;
}

const ONGOING_STATUSES = new Set(["pending", "generating", "reviewing", "plagchecking", "revamping", "verifying"]);

export function SmartCoGenProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [viewTeam, setViewTeamState] = useState<Team | null>(null);
  const loggedIn = !!user;
  const [screen, setScreen] = useState<Screen>("login");
  const [bankNav, setBankNavState] = useState<string[]>([]);
  const [bankFile, setBankFile] = useState<string | null>(null);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [finalRunId, setFinalRunId] = useState<string | null>(null);
  const [reviewBar, setReviewBar] = useState<ReviewBar | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  const [runs, setRuns] = useState<PastRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [catalog, setCatalog] = useState<SampleCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);

  // Optimistic/legacy overlay only — the source of truth is runs.finalised_at.
  const [localFinal, setLocalFinal] = useState<Set<string>>(new Set());
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  const [genOpen, setGenOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeStreams = useRef<Array<() => void>>([]);

  // Apply a parsed route to the store (shared by initial load, popstate and
  // programmatic navigation).
  const applyRoute = useCallback((input: RouteInput) => {
    const r = fullRoute(input);
    setBankNavState(r.bankNav);
    setBankFile(r.bankFile);
    setReviewRunId(r.reviewRunId);
    setFinalRunId(r.finalRunId);
    if (r.screen === "review") setReviewBar(null);
    setActiveTagId(r.activeTagId);
    setScreen(r.screen);
    setUserMenuOpen(false);
  }, []);

  // Push a new URL and apply it. No-op push when already on that path.
  const pushRoute = useCallback((r: RouteInput) => {
    const path = pathForRoute(r);
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    applyRoute(r);
  }, [applyRoute]);

  // hydrate client-only flags
  useEffect(() => {
    setLocalFinal(loadSet(LS_FINAL));
    setPublishedIds(loadSet(LS_PUB));
  }, []);

  /** Adopt a signed-in user and land on the URL they originally opened, so deep
   *  links survive the sign-in. Shared by session-restore and the login form. */
  const adoptUser = useCallback((u: AuthUser | null) => {
    setViewTeamState(initialViewTeam(u));
    setUser(u);
    if (u) applyRoute(parsePath(window.location.pathname));
    else setScreen("login");
  }, [applyRoute]);

  // Session restore: the httpOnly cookie is invisible to script, so ask the server.
  useEffect(() => {
    let cancelled = false;
    fetchMe().then((dto) => {
      if (cancelled) return;
      adoptUser(toAuthUser(dto));
      setAuthReady(true);
    });
    return () => { cancelled = true; };
  }, [adoptUser]);

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => applyRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyRoute]);

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

  const refreshTags = useCallback(async () => {
    try {
      const { tags } = await fetchTags();
      setTags(tags);
    } catch {
      /* transient; next action refetches */
    }
  }, []);

  const createTag = useCallback(async (name: string, color: string) => {
    try {
      const tag = await apiCreateTag(name, color);
      setTags((prev) => [...prev, tag]);
      return { tag };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not create tag." };
    }
  }, []);

  const deleteTag = useCallback(async (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setActiveTagId((cur) => (cur === id ? null : cur));
    try {
      await apiDeleteTag(id);
    } catch {
      refreshTags();
    }
  }, [refreshTags]);

  const toggleTagItem = useCallback(async (tagId: string, itemType: TagItemType, itemId: string, add: boolean) => {
    // optimistic membership update
    setTags((prev) =>
      prev.map((t) => {
        if (t.id !== tagId) return t;
        const without = t.items.filter((i) => !(i.item_type === itemType && i.item_id === itemId));
        return { ...t, items: add ? [...without, { item_type: itemType, item_id: itemId }] : without };
      }),
    );
    try {
      if (add) await addTagItem(tagId, itemType, itemId);
      else await removeTagItem(tagId, itemType, itemId);
    } catch {
      refreshTags();
    }
  }, [refreshTags]);

  // Switch the workspace to another granted team: persist the choice (so
  // authHeader() scopes subsequent requests), drop the stale lists, refetch.
  const setViewTeam = useCallback(
    (t: Team) => {
      try {
        localStorage.setItem(LS_VIEW_TEAM, t);
      } catch {
        /* ignore */
      }
      setViewTeamState(t);
      setRuns([]);
      setCatalog([]);
      setTags([]);
      setActiveTagId(null);
      refreshRuns();
      refreshCatalog();
      refreshTags();
    },
    [refreshRuns, refreshCatalog, refreshTags],
  );

  // initial + polling loads once authenticated
  useEffect(() => {
    if (!loggedIn) return;
    refreshRuns();
    refreshCatalog();
    refreshTags();
    const iv = setInterval(() => {
      // keep the runs list live so the pipeline animates as the backend works
      refreshRuns();
    }, 4000);
    return () => clearInterval(iv);
  }, [loggedIn, refreshRuns, refreshCatalog, refreshTags]);

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
    pushRoute({ screen: s });
  }, [pushRoute]);

  const setBankNav = useCallback((path: string[]) => {
    pushRoute({ screen: "banks", bankNav: path });
  }, [pushRoute]);
  const openBankFolder = useCallback((seg: string) => {
    setBankNavState((p) => {
      const next = [...p, seg];
      const path = pathForRoute({ screen: "banks", bankNav: next });
      if (typeof window !== "undefined" && window.location.pathname !== path) window.history.pushState(null, "", path);
      return next;
    });
  }, []);
  const openBank = useCallback((filename: string) => {
    pushRoute({ screen: "bank", bankFile: filename });
  }, [pushRoute]);
  const openReview = useCallback((runId: string) => {
    pushRoute({ screen: "review", reviewRunId: runId });
  }, [pushRoute]);
  const openFinalised = useCallback((runId: string) => {
    pushRoute({ screen: "finalisedRun", finalRunId: runId });
  }, [pushRoute]);
  const openTag = useCallback((tagId: string) => {
    pushRoute({ screen: "tag", activeTagId: tagId });
  }, [pushRoute]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: dto, error } = await apiLogin(email.trim(), password);
    if (error || !dto) return { error: error ?? "Sign-in failed" };
    adoptUser(toAuthUser(dto));
    return {};
  }, [adoptUser]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setRuns([]);
    setCatalog([]);
    if (typeof window !== "undefined") window.history.replaceState(null, "", "/");
    setScreen("login");
    setUserMenuOpen(false);
  }, []);

  const markFinalised = useCallback((id: string) => {
    // optimistic: flip the UI immediately; the server write makes it team-wide
    setLocalFinal((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(LS_FINAL, next);
      return next;
    });
    finaliseRun(id, user?.name ?? null)
      .then(() => refreshRuns())
      .catch(() => toast("Finalised on this device — server sync failed, will retry next visit"));
  }, [user, refreshRuns, toast]);
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
      pushRoute({ screen: "ongoing" });
    },
    [refreshRuns, pushRoute],
  );

  // The team-wide truth (runs.finalised_at) unioned with the optimistic /
  // legacy overlay, so finalising is instant and pre-migration flags still show.
  const finalisedIds = useMemo(() => {
    const s = new Set<string>(localFinal);
    for (const r of runs) if (r.finalised_at) s.add(r.id);
    return s;
  }, [runs, localFinal]);

  // One-time sync of legacy localStorage finalise flags to the server: once the
  // server row shows finalised_at, the local flag is retired.
  const finaliseSyncAttempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!loggedIn || runs.length === 0) return;
    const legacy = loadSet(LS_FINAL);
    if (!legacy.size) return;
    let changed = false;
    for (const r of runs) {
      if (!legacy.has(r.id)) continue;
      if (r.finalised_at) {
        legacy.delete(r.id);
        changed = true;
      } else if (!finaliseSyncAttempted.current.has(r.id)) {
        finaliseSyncAttempted.current.add(r.id);
        finaliseRun(r.id, user?.name ?? null).then(() => refreshRuns()).catch(() => {});
      }
    }
    if (changed) {
      saveSet(LS_FINAL, legacy);
      setLocalFinal(new Set(legacy));
    }
  }, [loggedIn, runs, user, refreshRuns]);

  const value: Ctx = {
    loggedIn,
    authReady,
    user,
    signIn,
    signOut,
    viewTeam,
    setViewTeam,
    screen,
    go,
    bankNav,
    setBankNav,
    openBankFolder,
    bankFile,
    openBank,
    reviewRunId,
    openReview,
    finalRunId,
    openFinalised,
    reviewBar,
    setReviewBar,
    activeTagId,
    openTag,
    runs,
    runsLoading,
    refreshRuns,
    catalog,
    catalogLoading,
    refreshCatalog,
    tags,
    refreshTags,
    createTag,
    deleteTag,
    toggleTagItem,
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

  return <SmartCoGenCtx.Provider value={value}>{children}</SmartCoGenCtx.Provider>;
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
