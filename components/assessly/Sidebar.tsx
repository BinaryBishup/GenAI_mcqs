"use client";

import { C } from "./theme";
import { HBox } from "./ui";
import {
  IconBank,
  IconCheck,
  IconDashboard,
  IconLock,
  IconLoop,
  IconLogout,
  IconSpark,
} from "./icons";
import { isOngoing, useAssessly, type Screen } from "./store";

const LOGO = "https://assetsprelogin.mettl.com/_next/image/?url=%2Fassets%2Flogo%2FMarsh-Mercer-Mettl.svg&w=256&q=75";

function NavLink({
  screen,
  icon,
  label,
  badge,
  badgeColor,
  trailingLock,
}: {
  screen: Screen;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeColor?: string;
  trailingLock?: boolean;
}) {
  const { screen: active, go } = useAssessly();
  const on = active === screen || (screen === "banks" && active === "bank") || (screen === "generated" && active === "review");
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
      {trailingLock ? <IconLock s={16} stroke="currentColor" style={{ opacity: 0.5 }} /> : null}
    </HBox>
  );
}

export function Sidebar() {
  const { runs, user, signOut, userMenuOpen, setUserMenuOpen, finalisedIds, publishedIds } = useAssessly();

  const ongoingCount = runs.filter(isOngoing).length;
  const awaitingCount = runs.filter((r) => r.status === "done" && !finalisedIds.has(r.id)).length;
  const finalisedCount = runs.filter((r) => r.status === "done" && finalisedIds.has(r.id) && !publishedIds.has(r.id)).length;

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
      <NavLink screen="banks" icon={<IconBank s={22} sw={1.7} />} label="Question Banks" trailingLock />

      <div style={{ marginTop: "auto", position: "relative", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.1)" }}>
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
