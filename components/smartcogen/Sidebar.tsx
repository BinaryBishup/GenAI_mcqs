"use client";

import { useState } from "react";
import { C } from "./theme";
import { HBox, HBtn } from "./ui";
import {
  IconBank,
  IconChat,
  IconCheck,
  IconDashboard,
  IconHelp,
  IconLoop,
  IconLogout,
  IconPlus,
  IconSpark,
} from "./icons";
import { isOngoing, useSmartCoGen, type Screen } from "./store";
import { TagDot, TagModal } from "./Tags";
import type { PastRunSummary } from "@/lib/types";
import { DAILY_TOKEN_BUDGET, EST_TOKENS_PER_QUESTION } from "@/lib/pipeline/limits";

const LOGO = "https://assetsprelogin.mettl.com/_next/image/?url=%2Fassets%2Flogo%2FMarsh-Mercer-Mettl.svg&w=256&q=75";

function NavLink({
  screen,
  icon,
  label,
  badge,
  badgeColor,
}: {
  screen: Screen;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeColor?: string;
}) {
  const { screen: active, go } = useSmartCoGen();
  const on = active === screen || (screen === "banks" && active === "bank") || (screen === "generated" && active === "review") || (screen === "finalised" && active === "finalisedRun");
  return (
    <HBox
      onClick={() => go(screen)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 14px",
        borderRadius: 11,
        cursor: "pointer",
        marginBottom: 5,
        fontSize: 16.5,
        fontWeight: on ? 700 : 600,
        color: on ? "#fff" : "rgba(255,255,255,.62)",
        background: on ? "rgba(255,255,255,.1)" : "transparent",
      }}
      hover={on ? undefined : { background: "rgba(255,255,255,.06)" }}
    >
      <span style={{ display: "inline-flex", color: "inherit" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? (
        <span style={{ fontSize: 12.5, fontWeight: 700, background: badgeColor, color: "#fff", borderRadius: 100, padding: "2px 8px" }}>{badge}</span>
      ) : null}
    </HBox>
  );
}

/** The TAGS section: create tags (via the shared modal) and jump to a tag's filtered view. */
function TagsSection() {
  const { tags, openTag, activeTagId, screen } = useSmartCoGen();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 14px 7px" }}>
        <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)" }}>TAGS</span>
        <HBtn
          onClick={() => setAdding(true)}
          style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.08)", color: "rgba(255,255,255,.75)", border: "none", borderRadius: 7, cursor: "pointer" }}
          hover={{ background: "rgba(255,255,255,.16)", color: "#fff" }}
          title="New tag"
        >
          <IconPlus s={15} />
        </HBtn>
      </div>

      {adding && <TagModal onClose={() => setAdding(false)} />}

      {tags.length === 0 && !adding && (
        <HBtn
          onClick={() => setAdding(true)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "10px 14px", marginTop: 2, background: "transparent", border: "1px dashed rgba(255,255,255,.2)", borderRadius: 11, color: "rgba(255,255,255,.55)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          hover={{ background: "rgba(255,255,255,.06)", border: "1px dashed rgba(255,255,255,.35)", color: "#fff" }}
        >
          <IconPlus s={15} />
          Create Tag
        </HBtn>
      )}

      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {tags.map((t) => {
          const on = screen === "tag" && activeTagId === t.id;
          return (
            <HBox
              key={t.id}
              onClick={() => openTag(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 11, cursor: "pointer", marginBottom: 3, background: on ? "rgba(255,255,255,.1)" : "transparent" }}
              hover={on ? undefined : { background: "rgba(255,255,255,.06)" }}
            >
              <TagDot color={t.color} s={10} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: on ? 700 : 600, color: on ? "#fff" : "rgba(255,255,255,.62)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.5)" }}>{t.items.length}</span>
            </HBox>
          );
        })}
      </div>
    </>
  );
}

/** Today's estimated token spend vs the daily budget, shown above the user
 *  card. Mirrors the enforcement in POST /api/generate (see lib/limits.ts);
 *  errored runs are excluded there too, so the two stay in step. */
function UsageSection({ runs }: { runs: PastRunSummary[] }) {
  const now = new Date();
  const today = runs.filter((r) => {
    if (r.status === "error") return false;
    const d = new Date(r.started_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
  const questions = today.reduce((t, r) => t + (r.count || 0), 0);
  const used = questions * EST_TOKENS_PER_QUESTION;
  const pct = Math.min(100, Math.round((used / DAILY_TOKEN_BUDGET) * 100));
  const barColor = pct >= 90 ? "#C0454B" : pct >= 70 ? "#E0A93B" : C.green;
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1_000)}k`);

  return (
    <div style={{ padding: "2px 8px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
        <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)" }}>DAILY TOKENS (EST.)</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.55)" }}>{fmt(used)} / {fmt(DAILY_TOKEN_BUDGET)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 100, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 100, background: barColor }} />
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginTop: 6 }}>
        {today.length} generation{today.length === 1 ? "" : "s"} · {questions} questions today
      </div>
    </div>
  );
}

export function Sidebar() {
  const { runs, user, signOut, userMenuOpen, setUserMenuOpen, finalisedIds, viewTeam, setViewTeam } = useSmartCoGen();

  const ongoingCount = runs.filter(isOngoing).length;
  const awaitingCount = runs.filter((r) => r.status === "done" && !finalisedIds.has(r.id)).length;
  const finalisedCount = runs.filter((r) => r.status === "done" && finalisedIds.has(r.id)).length;

  const name = user?.name ?? "Member";
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "M";

  return (
    <aside style={{ width: 360, flexShrink: 0, background: C.navyDeep, display: "flex", flexDirection: "column", padding: "20px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 8px 22px" }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: "7px 11px", display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Marsh Mercer Mettl" style={{ height: 24, display: "block" }} />
        </div>
      </div>

      <NavLink screen="dashboard" icon={<IconDashboard s={22} sw={1.7} />} label="Dashboard" />

      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)", padding: "16px 14px 7px" }}>GENERATION PIPELINE</div>
      <NavLink screen="ongoing" icon={<IconLoop s={22} sw={1.7} />} label="Ongoing Generations" badge={ongoingCount || undefined} badgeColor={C.green} />
      <NavLink screen="generated" icon={<IconSpark s={22} sw={1.7} />} label="Generated Sets" badge={awaitingCount || undefined} badgeColor="#E8A317" />
      <NavLink screen="finalised" icon={<IconCheck s={22} sw={1.7} />} label="Finalised Banks" badge={finalisedCount || undefined} badgeColor={C.green} />

      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)", padding: "16px 14px 7px" }}>ADMIN LIBRARY</div>
      <NavLink screen="banks" icon={<IconBank s={22} sw={1.7} />} label="Question Banks" />

      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)", padding: "16px 14px 7px" }}>SUPPORT</div>
      <NavLink screen="faqs" icon={<IconHelp s={22} sw={1.7} />} label="FAQs" />

      <TagsSection />

      <div style={{ marginTop: "auto" }}>
        <UsageSection runs={runs} />
      </div>
      <div style={{ position: "relative", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.1)" }}>
        <HBox
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          style={{ padding: 8, borderRadius: 12, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }}
          hover={{ background: "rgba(255,255,255,.06)" }}
        >
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.green, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "#fff", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".4px", color: "#fff", background: "rgba(122,181,44,.22)", border: "1px solid rgba(122,181,44,.4)", borderRadius: 100, padding: "1px 7px" }}>{user?.team ?? "—"}</span>
              <span style={{ color: "rgba(255,255,255,.45)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</span>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.8"><path d="M5 11l4-4 4 4" /></svg>
        </HBox>

        {userMenuOpen && (
          <>
            <div onClick={() => setUserMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70 }} />
            <div style={{ position: "absolute", left: "calc(100% - 2px)", bottom: 6, zIndex: 71, width: 220, background: "#08183A", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, padding: 7, boxShadow: "0 18px 50px rgba(0,0,0,.5)" }}>
              <div style={{ padding: "8px 12px 10px" }}>
                <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{name}</div>
                <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, marginTop: 2 }}>{user?.team} team</div>
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "0 10px 5px" }} />
              {/* Team switcher — hidden for single-team members; picks which granted
                  team's data the workspace shows. */}
              {user && user.teams.length > 1 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.34)", padding: "6px 12px 4px" }}>TEAM</div>
                  {user.teams.map((t) => {
                    const active = (viewTeam ?? user.teams[0]) === t;
                    return (
                      <HBox
                        key={t}
                        onClick={() => {
                          setViewTeam(t);
                          setUserMenuOpen(false);
                        }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: "pointer", color: active ? "#fff" : "rgba(255,255,255,.72)", fontSize: 13.5, fontWeight: active ? 700 : 500, background: active ? "rgba(255,255,255,.08)" : "transparent", marginBottom: 2 }}
                        hover={active ? undefined : { background: "rgba(255,255,255,.06)" }}
                      >
                        <span style={{ flex: 1 }}>{t}</span>
                        {active && <IconCheck s={15} sw={2.2} />}
                      </HBox>
                    );
                  })}
                  <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "5px 10px" }} />
                </>
              )}
              <HBox onClick={signOut} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", borderRadius: 9, cursor: "pointer", color: "#fff", fontSize: 13.5, fontWeight: 500 }} hover={{ background: "rgba(255,255,255,.08)" }}>
                <IconLogout s={17} />
                Sign out
              </HBox>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
