"use client";

import { C, diffStyle, titleCase } from "./theme";
import { HBtn, Spinner } from "./ui";
import { IconChevLeft, IconLock, IconLoop, IconPencil, IconSpark, IconCheck, IconTrash } from "./icons";
import { isOngoing, useAssessly } from "./store";
import { ExportMenu } from "./ExportMenu";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: "Team workspace", subtitle: "Generate, review and finalise question banks for your team." },
  ongoing: { title: "Ongoing Generations", subtitle: "Live generation jobs moving through the pipeline." },
  generated: { title: "Generated Sets", subtitle: "Finished generations awaiting your review and approval." },
  finalised: { title: "Finalised Banks", subtitle: "Approved sets — open a bank to view and export its questions." },
  banks: { title: "Question Banks", subtitle: "Your team's Local banks and the shared Mettl Admin inventory." },
  scratch: { title: "Team workspace", subtitle: "Generate, review and finalise question banks for your team." },
};

function PrimaryActions() {
  const { setGenOpen, setScratchOpen } = useAssessly();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <HBtn
        onClick={() => setScratchOpen(true)}
        style={{ height: 40, padding: "0 16px", whiteSpace: "nowrap", background: "#fff", color: C.navy, border: "1.5px solid #C9D4E6", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        hover={{ borderColor: C.navy, background: "#F4F7FC" }}
      >
        <IconPencil s={16} />
        Create from scratch
      </HBtn>
      <HBtn
        onClick={() => setGenOpen(true)}
        style={{ height: 40, padding: "0 16px", whiteSpace: "nowrap", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        hover={{ background: C.navyHover }}
      >
        <IconSpark s={16} />
        Generate Questions
      </HBtn>
    </div>
  );
}

const VIEW_ONLY = (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "8px 12px", borderRadius: 100, color: C.slate2, background: "#EEF1F5", whiteSpace: "nowrap" }}>
    <IconLock s={13} />
    View only
  </span>
);

export function Topbar() {
  const { screen, bankFile, go, reviewBar, activeTagId, tags, runs, deleteTag, finalRunId } = useAssessly();

  let title = TITLES[screen]?.title ?? "Workspace";
  let subtitle = TITLES[screen]?.subtitle ?? "";
  if (screen === "bank" && bankFile) {
    title = bankFile;
    subtitle = "Sample question bank · view only";
  }
  const finalRun = screen === "finalisedRun" ? runs.find((r) => r.id === finalRunId) : undefined;
  if (screen === "finalisedRun") {
    title = finalRun?.topic || "Finalised bank";
    subtitle = "Finalised bank · read only";
  }
  const tag = screen === "tag" ? tags.find((t) => t.id === activeTagId) : undefined;
  if (screen === "tag") {
    title = tag ? tag.name : "Tag";
    subtitle = "Generations and banks filed under this tag.";
  }
  if (screen === "review" && reviewBar) {
    title = reviewBar.title;
    subtitle = "Review each question, then finalise the approved set.";
  }

  const dd = reviewBar ? diffStyle(reviewBar.difficulty) : null;

  return (
    <header style={{ height: 76, flexShrink: 0, background: "#fff", borderBottom: "1px solid #EEF1F4", display: "flex", alignItems: "center", padding: "0 40px", gap: 20 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy, letterSpacing: "-.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {screen === "ongoing" && runs.some(isOngoing) && <Spinner size={15} />}
          {tag && (
            <span style={{ fontSize: 12, fontWeight: 700, color: C.slate2, background: "#EEF1F5", borderRadius: 100, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>
              {tag.items.length} item{tag.items.length === 1 ? "" : "s"}
            </span>
          )}
          {screen === "review" && dd && (
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: dd.fg, background: dd.bg, whiteSpace: "nowrap", flexShrink: 0 }}>
              {titleCase(reviewBar!.difficulty)} difficulty
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
      </div>
      <div style={{ flex: 1 }} />

      {(screen === "dashboard" || screen === "ongoing" || screen === "generated" || screen === "finalised" || screen === "banks" || screen === "tag") && <PrimaryActions />}

      {tag && (
        <HBtn
          onClick={() => { if (confirm(`Delete the tag "${tag.name}"? The generations and banks themselves are not deleted.`)) { deleteTag(tag.id); go("dashboard"); } }}
          style={{ height: 38, padding: "0 14px", background: "#fff", color: "#C0454B", border: "1.5px solid #F0D2D4", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}
          hover={{ background: "#FCEBEC", borderColor: "#E4A9AD" }}
        >
          <IconTrash s={15} />Delete tag
        </HBtn>
      )}

      {screen === "finalisedRun" && finalRunId && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HBtn
            onClick={() => go("finalised")}
            style={{ height: 40, padding: "0 15px", background: "#fff", color: C.slate, border: "1.5px solid #E3E8ED", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
            hover={{ borderColor: C.navy, color: C.navy }}
          >
            <IconChevLeft s={16} sw={1.9} />
            All finalised
          </HBtn>
          <ExportMenu runId={finalRunId} topic={finalRun?.topic || "finalised"} />
        </div>
      )}

      {screen === "scratch" && (
        <HBtn
          onClick={() => go("dashboard")}
          style={{ height: 40, padding: "0 15px", background: "#fff", color: C.slate, border: "1.5px solid #E3E8ED", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
          hover={{ borderColor: C.navy, color: C.navy }}
        >
          <IconChevLeft s={16} sw={1.9} />
          Dashboard
        </HBtn>
      )}

      {screen === "bank" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HBtn
            onClick={() => go("banks")}
            style={{ height: 40, padding: "0 15px", background: "#fff", color: C.slate, border: "1.5px solid #E3E8ED", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
            hover={{ borderColor: C.navy, color: C.navy }}
          >
            <IconChevLeft s={16} sw={1.9} />
            All banks
          </HBtn>
          {VIEW_ONLY}
        </div>
      )}

      {screen === "review" && reviewBar && (
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <HBtn
            onClick={reviewBar.onRegenerate}
            style={{ height: 40, padding: "0 15px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}
            hover={{ borderColor: "#C8D2DC" }}
          >
            <IconLoop s={15} />
            Regenerate
          </HBtn>
          <HBtn
            onClick={reviewBar.onFinalise}
            style={{ height: 40, padding: "0 17px", whiteSpace: "nowrap", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
            hover={{ background: C.navyHover }}
          >
            <IconCheck s={15} sw={2} />
            Finalise {reviewBar.approved} to bank
          </HBtn>
        </div>
      )}
    </header>
  );
}
