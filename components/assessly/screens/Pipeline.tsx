"use client";

import { C } from "../theme";
import { HBtn, HBox, Spinner } from "../ui";
import { IconCheck, IconClock, IconShift, IconSpark } from "../icons";
import { isOngoing, useAssessly } from "../store";
import { Cell, EmptyRow, runView, StatusPill, TableShell, Th, TitleCell, type RunView } from "./common";

function useBuckets() {
  const { runs, finalisedIds, publishedIds, user } = useAssessly();
  const by = user?.name ?? "—";
  const ongoing = runs.filter(isOngoing).map((r) => runView(r, false, by));
  const awaiting = runs.filter((r) => r.status === "done" && !finalisedIds.has(r.id)).map((r) => runView(r, false, by));
  const finalised = runs.filter((r) => r.status === "done" && finalisedIds.has(r.id)).map((r) => ({ v: runView(r, true, by), published: publishedIds.has(r.id) }));
  const errored = runs.filter((r) => r.status === "error").map((r) => runView(r, false, by));
  return { ongoing, awaiting, finalised, errored };
}

const ONGOING_COLS = "2.3fr 1.5fr .8fr 1.1fr 1.3fr";

// ============================ DASHBOARD ============================
export function Dashboard() {
  const { go, openReview, markPublished, toast } = useAssessly();
  const { ongoing, awaiting, finalised } = useBuckets();

  const unpublished = finalised.filter((f) => !f.published);
  const stats = [
    { label: "Generating now", value: ongoing.length },
    { label: "Active generations", value: ongoing.length },
    { label: "Awaiting your review", value: awaiting.length },
    { label: "Questions to publish", value: unpublished.reduce((t, f) => t + f.v.count, 0) },
  ];

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 26 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ flex: 1, minWidth: 180, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "17px 19px" }}>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.navy, letterSpacing: "-.5px", marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Generations in progress</h3>
        <span onClick={() => go("ongoing")} style={{ fontSize: 13, color: C.navy, fontWeight: 600, cursor: "pointer" }}>View all →</span>
      </div>
      <div style={{ marginBottom: 30 }}>
        <TableShell cols={ONGOING_COLS} header={<><Th>GENERATION</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>CREATED BY</Th><Th dim>STATUS</Th></>}>
          {ongoing.map((v) => (
            <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: ONGOING_COLS, alignItems: "center", gap: 14, padding: "15px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
              <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
              <Cell>{v.src}</Cell>
              <Cell bold>{v.count}</Cell>
              <Cell>{v.by}</Cell>
              <StatusPill v={v} />
            </HBox>
          ))}
          {ongoing.length === 0 && <EmptyRow>Nothing generating right now.</EmptyRow>}
        </TableShell>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 13 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "#FBF1E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconClock s={17} stroke="#B0700C" />
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Needs your attention</h3>
        <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 500 }}>Review finished generations, then shift finalised sets to the shared Admin Pool.</span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1.5fr .8fr 1.1fr 178px", alignItems: "center", gap: 14, padding: "14px 22px", background: C.navy }}>
          <Th>GENERATION</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>CREATED BY</Th><Th dim right>ACTION</Th>
        </div>

        <GroupHeader dot="#E0A93B" fg="#B0700C" bg="#FCF7EC" label="AWAITING REVIEW" count={awaiting.length} />
        {awaiting.map((v) => (
          <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: "2.4fr 1.5fr .8fr 1.1fr 178px", alignItems: "center", gap: 14, padding: "14px 22px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
            <TitleCell title={v.title} sub={v.when} />
            <Cell>{v.src}</Cell>
            <Cell bold>{v.count}</Cell>
            <Cell>{v.by}</Cell>
            <HBtn onClick={() => openReview(v.id)} style={{ height: 36, justifySelf: "end", padding: "0 15px", background: C.navy, color: "#fff", border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }} hover={{ background: C.navyHover }}>
              Review &amp; finalise
            </HBtn>
          </HBox>
        ))}
        {awaiting.length === 0 && <div style={{ padding: "16px 22px", borderTop: "1px solid #F0F3F6", color: C.faint, fontSize: 12.5 }}>No generations waiting for review.</div>}

        <GroupHeader dot={C.navy} fg={C.navy} bg="#F3F6FB" label="FINALISED · READY TO SHIFT" count={unpublished.length} />
        {unpublished.map(({ v }) => (
          <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: "2.4fr 1.5fr .8fr 1.1fr 178px", alignItems: "center", gap: 14, padding: "14px 22px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
              <IconCheck s={15} stroke="#4C8A28" sw={2.4} style={{ flexShrink: 0 }} />
              <TitleCell title={v.title} sub={`Finalised · ${v.when}`} />
            </div>
            <Cell>{v.src}</Cell>
            <Cell bold>{v.count}</Cell>
            <Cell>{v.by}</Cell>
            <HBtn onClick={(e) => { e.stopPropagation(); markPublished(v.id); toast("Generation shifted to the Admin Pool"); }} style={{ height: 36, justifySelf: "end", padding: "0 15px", background: "#fff", color: C.navy, border: `1.5px solid ${C.navy}`, borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }} hover={{ background: "#E1E8F4" }}>
              <IconShift s={13} />
              Shift to admin
            </HBtn>
          </HBox>
        ))}
        {unpublished.length === 0 && <div style={{ padding: "16px 22px", borderTop: "1px solid #F0F3F6", color: C.faint, fontSize: 12.5 }}>Nothing finalised waiting to be published.</div>}
      </div>
    </div>
  );
}

function GroupHeader({ dot, fg, bg, label, count }: { dot: string; fg: string; bg: string; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 22px", background: bg, borderTop: "1px solid #F0F3F6" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: fg }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: fg, background: "rgba(0,0,0,.04)", borderRadius: 100, padding: "1px 8px" }}>{count}</span>
    </div>
  );
}

// ============================ ONGOING ============================
export function Ongoing() {
  const { ongoing } = useBuckets();
  const { openReview } = useAssessly();
  return (
    <div style={{ maxWidth: "none" }}>
      <Heading icon={<Spinner size={15} />} iconBg="#E8EDF6" title="Ongoing generations" sub="Live jobs moving through Generating → Reviewing → Ready for review." />
      <TableShell cols={ONGOING_COLS} header={<><Th>GENERATION</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>CREATED BY</Th><Th dim>STATUS</Th></>}>
        {ongoing.map((v) => (
          <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: ONGOING_COLS, alignItems: "center", gap: 14, padding: "15px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
            <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
            <Cell>{v.src}</Cell>
            <Cell bold>{v.count}</Cell>
            <Cell>{v.by}</Cell>
            <StatusPill v={v} />
          </HBox>
        ))}
        {ongoing.length === 0 && <EmptyRow>Nothing being generated right now.</EmptyRow>}
      </TableShell>
    </div>
  );
}

// ============================ GENERATED ============================
export function Generated() {
  const { openReview } = useAssessly();
  const { awaiting } = useBuckets();
  const COLS = "2.3fr 1.5fr .8fr 1.1fr 1.2fr 168px";
  return (
    <div style={{ maxWidth: "none" }}>
      <Heading icon={<IconSpark s={17} stroke="#B0700C" />} iconBg="#FBF1E0" title="Generated sets" sub="Finished generations awaiting your review and approval." />
      <TableShell cols={COLS} header={<><Th>GENERATION</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>CREATED BY</Th><Th dim>STATUS</Th><span /></>}>
        {awaiting.map((v) => (
          <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 14, padding: "16px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
            <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
            <Cell>{v.src}</Cell>
            <Cell bold>{v.count}</Cell>
            <Cell>{v.by}</Cell>
            <span><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: "#B0700C", background: "#FBF1E0" }}>Awaiting review</span></span>
            <HBtn onClick={() => openReview(v.id)} style={{ height: 36, justifySelf: "end", padding: "0 15px", background: C.navy, color: "#fff", border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }} hover={{ background: C.navyHover }}>
              Review &amp; finalise
            </HBtn>
          </HBox>
        ))}
        {awaiting.length === 0 && <EmptyRow>No generations waiting for review.</EmptyRow>}
      </TableShell>
    </div>
  );
}

// ============================ FINALISED ============================
export function Finalised() {
  const { openReview, markPublished, toast } = useAssessly();
  const { finalised } = useBuckets();
  const COLS = "2.3fr 1.5fr .8fr 1.1fr 1.2fr 250px";
  return (
    <div style={{ maxWidth: "none" }}>
      <Heading icon={<IconCheck s={17} stroke="#4C8A28" sw={2} />} iconBg="#EAF6E4" title="Finalised banks" sub="Freshly finalised sets — review, then shift to the shared Admin Pool." />
      <TableShell cols={COLS} header={<><Th>BANK</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>CREATED BY</Th><Th dim>STATUS</Th><Th dim right>ACTION</Th></>}>
        {finalised.map(({ v, published }) => (
          <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 14, padding: "16px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
            <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
            <Cell>{v.src}</Cell>
            <Cell bold>{v.count}</Cell>
            <Cell>{v.by}</Cell>
            <span><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: "#4C8A28", background: "#EEF6E2" }}><IconCheck s={12} stroke="#4C8A28" sw={2.4} />Finalised</span></span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
              <HBtn onClick={(e) => { e.stopPropagation(); openReview(v.id); }} style={{ height: 36, padding: "0 13px", background: "#fff", color: C.slate, border: "1.5px solid #E3E8ED", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }} hover={{ borderColor: "#C8D2DC", background: "#FAFBFC" }}>
                Review
              </HBtn>
              {published ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#4C8A28", whiteSpace: "nowrap" }}>
                  <IconCheck s={13} stroke="#4C8A28" sw={2.2} />In Admin Pool
                </span>
              ) : (
                <HBtn onClick={(e) => { e.stopPropagation(); markPublished(v.id); toast("Generation shifted to the Admin Pool"); }} style={{ height: 36, padding: "0 14px", background: C.navy, color: "#fff", border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }} hover={{ background: C.navyHover }}>
                  <IconShift s={13} />Shift to admin
                </HBtn>
              )}
            </div>
          </HBox>
        ))}
        {finalised.length === 0 && <EmptyRow>No finalised banks yet. Review a generated set and finalise it to see it here.</EmptyRow>}
      </TableShell>
    </div>
  );
}

function Heading({ icon, iconBg, title, sub }: { icon: React.ReactNode; iconBg: string; title: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: C.navy }}>{title}</h3>
      <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 500 }}>{sub}</span>
    </div>
  );
}
