"use client";

import { useState } from "react";
import { C } from "./theme";
import { HBox, HBtn, HInput } from "./ui";
import { IconTag, IconCheck, IconTrash, IconSpark, IconBook, IconX } from "./icons";
import { useAssessly } from "./store";
import type { TagItemType } from "@/lib/types";
import { Cell, EmptyRow, runView, StatusPill, TableShell, Th, TitleCell } from "./screens/common";

/** Palette offered when creating a tag. */
export const TAG_COLORS = ["#7AB52C", "#3A56B4", "#E0A93B", "#C0454B", "#8B5CF6", "#0EA5A0", "#EC4899", "#5A6B7B"];

/** A small coloured dot for a tag. */
export function TagDot({ color, s = 9 }: { color: string; s?: number }) {
  return <span style={{ width: s, height: s, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
}

/**
 * Centered modal for filing an item under tags and/or creating a tag. Pass
 * itemType/itemId to show the membership list; omit them (sidebar "New tag")
 * for a create-only modal. Rendered position:fixed so it never clips inside
 * scrollable or overflow-hidden lists (which the old anchored popover did).
 */
export function TagModal({ itemType, itemId, onClose }: { itemType?: TagItemType; itemId?: string; onClose: () => void }) {
  const { tags, toggleTagItem, createTag, openTag, toast } = useAssessly();
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const forItem = itemType !== undefined && itemId !== undefined;
  const isMember = (id: string) => tags.find((t) => t.id === id)?.items.some((i) => i.item_type === itemType && i.item_id === itemId) ?? false;

  const submitCreate = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const { tag, error } = await createTag(n, color);
    setBusy(false);
    if (error || !tag) { toast(error ?? "Could not create tag."); return; }
    setName("");
    if (forItem) {
      // file the current item under the tag we just made; stay open so the
      // user sees it ticked in the list
      toggleTagItem(tag.id, itemType!, itemId!, true);
    } else {
      onClose();
      openTag(tag.id);
    }
  };

  return (
    <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 430, maxWidth: "100%", maxHeight: "84vh", background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #EDF1F4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E9F3DA", display: "flex", alignItems: "center", justifyContent: "center" }}><IconTag s={17} stroke="#4C8A28" /></div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{forItem ? "Add to tag" : "New tag"}</div>
              <div style={{ fontSize: 12.5, color: C.muted }}>{forItem ? "File this under one or more tags." : "Group generations & banks for a client."}</div>
            </div>
          </div>
          <HBox onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} hover={{ background: "#E9EDF1" }}><IconX s={16} stroke={C.slate} /></HBox>
        </div>

        {forItem && (
          <div style={{ overflowY: "auto", padding: "10px 14px" }}>
            {tags.length === 0 && <div style={{ padding: "8px 8px 10px", fontSize: 13, color: C.faint }}>No tags yet. Create one below.</div>}
            {tags.map((t) => {
              const on = isMember(t.id);
              return (
                <HBox key={t.id} onClick={() => toggleTagItem(t.id, itemType!, itemId!, !on)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 10px", borderRadius: 9, cursor: "pointer" }} hover={{ background: "#F5F7FA" }}>
                  <TagDot color={t.color} s={10} />
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: on ? 700 : 500, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                  <span style={{ width: 19, height: 19, borderRadius: 6, border: `1.5px solid ${on ? C.navy : "#D3DAE3"}`, background: on ? C.navy : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {on && <IconCheck s={12} stroke="#fff" sw={2.4} />}
                  </span>
                </HBox>
              );
            })}
          </div>
        )}

        <div style={{ borderTop: forItem ? "1px solid #EDF1F4" : "none", padding: "16px 22px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.muted, marginBottom: 10 }}>CREATE NEW TAG</div>
          <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
            {TAG_COLORS.map((cc) => (
              <span key={cc} onClick={() => setColor(cc)} style={{ width: 20, height: 20, borderRadius: "50%", background: cc, cursor: "pointer", border: color === cc ? "2.5px solid #14213D" : "2.5px solid transparent", boxSizing: "border-box" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <HInput
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") onClose(); }}
              placeholder="Tag name"
              style={{ flex: 1, height: 40, border: "1.5px solid #E3E8ED", borderRadius: 9, padding: "0 12px", fontSize: 13.5, color: C.navy, background: "#fff", minWidth: 0 }}
              focusStyle={{ borderColor: C.navy, outline: "none" }}
            />
            <HBtn onClick={submitCreate} disabled={busy || !name.trim()} style={{ height: 40, padding: "0 18px", background: C.navy, color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: name.trim() ? "pointer" : "default", opacity: name.trim() ? 1 : 0.5, flexShrink: 0 }} hover={{ background: C.navyHover }}>
              {busy ? "Creating…" : "Create"}
            </HBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline coloured dots for the tags an item belongs to — visibility in list
 *  rows without opening the modal. Renders nothing for untagged items. */
export function TagDots({ itemType, itemId }: { itemType: TagItemType; itemId: string }) {
  const { tags } = useAssessly();
  const members = tags.filter((t) => t.items.some((i) => i.item_type === itemType && i.item_id === itemId));
  if (!members.length) return null;
  return (
    <span title={members.map((t) => t.name).join(", ")} style={{ display: "inline-flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
      {members.map((t) => <TagDot key={t.id} color={t.color} s={8} />)}
    </span>
  );
}

/**
 * Tag button for one taggable item (a run or a sample bank). Shows how many
 * tags the item is in; clicking opens the tag modal. Stops click propagation
 * so it works inside clickable list rows.
 */
export function TagPicker({ itemType, itemId, compact }: { itemType: TagItemType; itemId: string; compact?: boolean }) {
  const { tags } = useAssessly();
  const [open, setOpen] = useState(false);

  const isMember = (id: string) => tags.find((t) => t.id === id)?.items.some((i) => i.item_type === itemType && i.item_id === itemId) ?? false;
  const memberCount = tags.filter((t) => isMember(t.id)).length;

  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <HBtn
        onClick={() => setOpen(true)}
        style={{
          height: compact ? 30 : 34,
          padding: compact ? "0 9px" : "0 11px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: memberCount ? "#EEF4FF" : "#fff",
          color: memberCount ? C.navy : C.slate2,
          border: `1.5px solid ${memberCount ? "#C3D3F0" : "#E3E8ED"}`,
          borderRadius: 8,
          fontSize: 12.5,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        hover={{ borderColor: C.navy }}
      >
        <IconTag s={14} />
        {memberCount ? memberCount : "Tag"}
      </HBtn>

      {open && <TagModal itemType={itemType} itemId={itemId} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** The "tag" screen: everything filed under one tag, split by pipeline stage
 *  (in-flight generations vs finalised banks vs sample banks). The tag name,
 *  item count and Delete action live in the Topbar. */
export function TagScreen() {
  const { activeTagId, tags, runs, catalog, openReview, openFinalised, openBank, toggleTagItem, finalisedIds } = useAssessly();
  const tag = tags.find((t) => t.id === activeTagId) ?? null;

  if (!tag) {
    return <EmptyRowBlock text="This tag no longer exists." />;
  }

  const runIds = new Set(tag.items.filter((i) => i.item_type === "run").map((i) => i.item_id));
  const bankIds = new Set(tag.items.filter((i) => i.item_type === "sample").map((i) => i.item_id));
  const taggedAll = runs.filter((r) => runIds.has(r.id));
  const taggedRuns = taggedAll.filter((r) => !(r.status === "done" && finalisedIds.has(r.id))).map((r) => runView(r, false));
  const taggedFinal = taggedAll.filter((r) => r.status === "done" && finalisedIds.has(r.id)).map((r) => runView(r, true));
  const taggedBanks = catalog.filter((c) => bankIds.has(c.filename));
  const empty = taggedRuns.length === 0 && taggedFinal.length === 0 && taggedBanks.length === 0;

  const COLS = "2.5fr 1.4fr .8fr 1.2fr 150px";

  return (
    <div style={{ maxWidth: "none" }}>
      {/* Generations (not yet finalised) */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 11px" }}>
        <IconSpark s={16} stroke="#B0700C" />
        <h4 style={{ fontSize: 14.5, fontWeight: 800, color: C.navy }}>Generations</h4>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{taggedRuns.length}</span>
      </div>
      <div style={{ marginBottom: 26 }}>
        <TableShell cols={COLS} header={<><Th>GENERATION</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>STATUS</Th><Th dim right>REMOVE</Th></>}>
          {taggedRuns.map((v) => (
            <HBox key={v.id} onClick={() => openReview(v.id)} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 14, padding: "15px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
              <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
              <Cell>{v.src}</Cell>
              <Cell bold>{v.count}</Cell>
              <StatusPill v={v} />
              <span style={{ justifySelf: "end" }} onClick={(e) => { e.stopPropagation(); toggleTagItem(tag.id, "run", v.id, false); }}>
                <RemoveBtn />
              </span>
            </HBox>
          ))}
          {taggedRuns.length === 0 && <EmptyRow>No in-progress generations under this tag.</EmptyRow>}
        </TableShell>
      </div>

      {/* Finalised banks */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 11px" }}>
        <IconCheck s={16} stroke="#4C8A28" sw={2.2} />
        <h4 style={{ fontSize: 14.5, fontWeight: 800, color: C.navy }}>Finalised banks</h4>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{taggedFinal.length}</span>
      </div>
      <div style={{ marginBottom: 26 }}>
        <TableShell cols={COLS} header={<><Th>BANK</Th><Th dim>SOURCE</Th><Th dim>QUESTIONS</Th><Th dim>STATUS</Th><Th dim right>REMOVE</Th></>}>
          {taggedFinal.map((v) => (
            <HBox key={v.id} onClick={() => openFinalised(v.id)} style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", gap: 14, padding: "15px 24px", borderTop: "1px solid #F0F3F6", cursor: "pointer" }} hover={{ background: "#F7F9FC" }}>
              <TitleCell title={v.title} sub={`${v.modeLabel} · ${v.when}`} />
              <Cell>{v.src}</Cell>
              <Cell bold>{v.count}</Cell>
              <span><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: "#4C8A28", background: "#EEF6E2" }}><IconCheck s={12} stroke="#4C8A28" sw={2.4} />Finalised</span></span>
              <span style={{ justifySelf: "end" }} onClick={(e) => { e.stopPropagation(); toggleTagItem(tag.id, "run", v.id, false); }}>
                <RemoveBtn />
              </span>
            </HBox>
          ))}
          {taggedFinal.length === 0 && <EmptyRow>No finalised banks under this tag yet.</EmptyRow>}
        </TableShell>
      </div>

      {/* Banks */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 11px" }}>
        <IconBook s={16} stroke={C.navy} />
        <h4 style={{ fontSize: 14.5, fontWeight: 800, color: C.navy }}>Question banks</h4>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{taggedBanks.length}</span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, overflow: "hidden" }}>
        {taggedBanks.map((b) => (
          <HBox key={b.filename} onClick={() => openBank(b.filename)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 22px", cursor: "pointer", borderTop: "1px solid #F0F3F6" }} hover={{ background: "#F7F9FC" }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconBook s={17} stroke={C.navy} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.filename}</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{b.topic}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.slate2, whiteSpace: "nowrap" }}>{b.count} Qs</span>
            <span onClick={(e) => { e.stopPropagation(); toggleTagItem(tag.id, "sample", b.filename, false); }}>
              <RemoveBtn />
            </span>
          </HBox>
        ))}
        {taggedBanks.length === 0 && <div style={{ padding: "18px 22px", color: C.faint, fontSize: 12.5, borderTop: "1px solid #F0F3F6" }}>No banks tagged yet. Use the Tag button on any bank.</div>}
      </div>

      {empty && <div style={{ marginTop: 20, textAlign: "center", color: C.faint, fontSize: 12.5 }}>Tip: open Generated Sets, Finalised Banks or Question Banks and use the Tag button on a row to file it here.</div>}
    </div>
  );
}

function RemoveBtn() {
  return (
    <HBtn style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", justifySelf: "end", background: "#fff", color: C.faint, border: "1.5px solid #E3E8ED", borderRadius: 8, cursor: "pointer" }} hover={{ color: "#C0454B", borderColor: "#E4A9AD", background: "#FCEBEC" }}>
      <IconTrash s={14} />
    </HBtn>
  );
}

function EmptyRowBlock({ text }: { text: string }) {
  return <div style={{ padding: 40, textAlign: "center", color: C.faint, fontSize: 13.5, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14 }}>{text}</div>;
}
