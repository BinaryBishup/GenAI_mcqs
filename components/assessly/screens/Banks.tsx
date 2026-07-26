"use client";

import { useEffect, useMemo, useState } from "react";
import { C, diffStyle, optView, titleCase } from "../theme";
import { HBtn, HBox, HInput, Spinner } from "../ui";
import { IconBank, IconBook, IconCheck, IconChevLeft, IconChevRight, IconFolder, IconLock, IconPencil, IconSearch, IconUpload, IconX } from "../icons";
import { useAssessly } from "../store";
import { UploadBankModal } from "../UploadBankModal";
import { TagPicker } from "../Tags";
import { fetchTopic, renameSample } from "@/lib/api";
import type { Difficulty, SampleTopic } from "@/lib/types";

type BanksTab = "local" | "admin";

// ============================ BANK TREE ============================
export function Banks() {
  const { catalog, catalogLoading, bankNav, setBankNav, openBankFolder, openBank, refreshCatalog, refreshTags, toast } = useAssessly();
  const [tab, setTab] = useState<BanksTab>("local");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Inline rename of one bank row: which filename is being edited + draft value.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const q = search.trim().toLowerCase();

  const saveRename = async () => {
    const n = renameVal.trim();
    if (!renaming || renameBusy) return;
    if (!n || n === renaming) { setRenaming(null); return; }
    setRenameBusy(true);
    try {
      await renameSample(renaming, n);
      setRenaming(null);
      refreshCatalog();
      refreshTags();
      toast(`Renamed to "${n}"`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setRenameBusy(false);
    }
  };

  // group catalog by topic → folder; each file = a leaf bank
  const folders = useMemo(() => {
    const map = new Map<string, { count: number; q: number }>();
    for (const it of catalog) {
      const key = it.topic || "Uncategorised";
      const cur = map.get(key) || { count: 0, q: 0 };
      cur.count += 1;
      cur.q += it.count;
      map.set(key, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  let folderRows: { name: string; meta: string; q: number }[] = [];
  let leafRows: { name: string; chain: string; q: number; showChain: boolean; by: string | null }[] = [];

  if (q) {
    leafRows = catalog
      .filter((it) => (it.filename + " " + it.topic).toLowerCase().includes(q))
      .map((it) => ({ name: it.filename, chain: it.topic, q: it.count, showChain: true, by: it.uploaded_by }));
  } else if (bankNav.length === 0) {
    folderRows = folders
      .filter(([name]) => name.toLowerCase().includes(q))
      .map(([name, m]) => ({ name, meta: `${m.count} ${m.count === 1 ? "bank" : "banks"}`, q: m.q }));
  } else {
    const topic = bankNav[0];
    leafRows = catalog.filter((it) => (it.topic || "Uncategorised") === topic).map((it) => ({ name: it.filename, chain: it.topic, q: it.count, showChain: false, by: it.uploaded_by }));
  }

  const crumbs = [{ label: "All groups", path: [] as string[] }].concat(bankNav.map((seg, i) => ({ label: seg, path: bankNav.slice(0, i + 1) })));
  const empty = folderRows.length === 0 && leafRows.length === 0;

  return (
    <div style={{ maxWidth: "none" }}>
      {/* Admin (Mettl inventory) vs Local (this team's banks) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, background: "#EAEEF3", padding: 5, borderRadius: 12 }}>
          {([["local", "Local"], ["admin", "Admin"]] as [BanksTab, string][]).map(([k, label]) => {
            const on = tab === k;
            return (
              <div key={k} onClick={() => setTab(k)} style={{ padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", color: on ? C.navy : C.slate2, background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 3px rgba(0,15,71,.12)" : "none" }}>{label}</div>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        {tab === "local" && (
          <HBtn onClick={() => setUploadOpen(true)} style={{ height: 40, padding: "0 16px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} hover={{ background: C.navyHover }}>
            <IconUpload s={16} />Upload bank
          </HBtn>
        )}
      </div>

      {tab === "admin" ? (
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "56px 24px", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#EEF2F6", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <IconBank s={24} stroke={C.slate2} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Mettl inventory</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 100, color: C.slate2, background: "#EEF1F5" }}>
            <IconLock s={13} />Not connected yet
          </span>
        </div>
      ) : (
      <>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, flexWrap: "wrap", flex: 1 }}>
          {crumbs.map((cr, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span onClick={() => setBankNav(cr.path)} style={{ cursor: "pointer", fontWeight: i === crumbs.length - 1 ? 700 : 600, color: C.slate }}>{cr.label}</span>
              {i < crumbs.length - 1 && <span style={{ color: "#C3C9D2" }}>›</span>}
            </span>
          ))}
        </div>
        <div style={{ position: "relative", width: "clamp(190px,24vw,280px)" }}>
          <IconSearch s={15} stroke={C.muted} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }} />
          <HInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search banks & groups…" style={{ width: "100%", height: 40, border: "1.5px solid #E3E8ED", borderRadius: 10, padding: "0 12px 0 36px", fontSize: 13, color: C.navy, background: "#fff" }} focusStyle={{ borderColor: C.navy, outline: "none" }} />
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, overflow: "hidden" }}>
        {bankNav.length > 0 && !q && (
          <HBox onClick={() => setBankNav(bankNav.slice(0, -1))} style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 22px", cursor: "pointer", borderBottom: "1px solid #F0F3F6" }} hover={{ background: "#F7F9FC" }}>
            <IconChevLeft s={17} stroke={C.muted} sw={1.9} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: C.slate2 }}>Back</span>
          </HBox>
        )}

        {folderRows.map((f) => (
          <HBox key={f.name} onClick={() => openBankFolder(f.name)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 22px", cursor: "pointer", borderBottom: "1px solid #F0F3F6" }} hover={{ background: "#F7F9FC" }}>
            <IconChevRight s={18} stroke={C.navy} sw={1.8} />
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "#EEF2F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconFolder s={18} stroke={C.slate} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{f.meta}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.slate2, whiteSpace: "nowrap" }}>{f.q} Qs</span>
          </HBox>
        ))}

        {leafRows.map((b) => {
          const editing = renaming === b.name;
          return (
            <HBox key={b.name} onClick={() => { if (!editing) openBank(b.name); }} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 22px", cursor: editing ? "default" : "pointer", borderBottom: "1px solid #F0F3F6" }} hover={editing ? undefined : { background: "#F7F9FC" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconBook s={17} stroke={C.navy} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing ? (
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <HInput
                      value={renameVal}
                      autoFocus
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(null); }}
                      style={{ flex: 1, height: 36, border: "1.5px solid #C9D4E6", borderRadius: 9, padding: "0 11px", fontSize: 13.5, fontWeight: 600, color: C.navy, background: "#fff", minWidth: 0 }}
                      focusStyle={{ borderColor: C.navy, outline: "none" }}
                    />
                    <HBtn onClick={saveRename} disabled={renameBusy || !renameVal.trim()} title="Save" style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.navy, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", flexShrink: 0 }} hover={{ background: C.navyHover }}>
                      <IconCheck s={14} sw={2.4} />
                    </HBtn>
                    <HBtn onClick={() => setRenaming(null)} title="Cancel" style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: C.slate, border: "1.5px solid #E3E8ED", borderRadius: 8, cursor: "pointer", flexShrink: 0 }} hover={{ borderColor: "#C8D2DC" }}>
                      <IconX s={14} />
                    </HBtn>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{b.showChain ? `${b.chain} · ` : ""}Uploaded by {b.by || "—"}</div>
                  </>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.slate2, whiteSpace: "nowrap" }}>{b.q} Qs</span>
              {!editing && (
                <span onClick={(e) => e.stopPropagation()}>
                  <HBtn onClick={() => { setRenaming(b.name); setRenameVal(b.name); }} title="Rename bank" style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: C.slate2, border: "1.5px solid #E3E8ED", borderRadius: 8, cursor: "pointer" }} hover={{ borderColor: C.navy, color: C.navy }}>
                    <IconPencil s={14} />
                  </HBtn>
                </span>
              )}
              <TagPicker itemType="sample" itemId={b.name} compact />
              <IconChevRight s={16} stroke="#C3C9D2" sw={2} />
            </HBox>
          );
        })}

        {empty && (
          <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13 }}>
            {catalogLoading ? <Spinner size={16} /> : "No banks yet — upload one to get started."}
          </div>
        )}
      </div>
      </>
      )}

      <UploadBankModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(r) => { refreshCatalog(); toast(`Uploaded ${r.inserted} questions to ${r.topic}`); }}
      />
    </div>
  );
}

// ============================ BANK DETAIL ============================
const DIFF_CHIPS: ("all" | Difficulty)[] = ["all", "easy", "medium", "hard"];

export function BankDetail() {
  const { bankFile } = useAssessly();
  const [topic, setTopic] = useState<SampleTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [diff, setDiff] = useState<"all" | Difficulty>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!bankFile) return;
    let cancelled = false;
    setLoading(true);
    setTopic(null);
    fetchTopic(bankFile)
      .then((t) => { if (!cancelled) setTopic(t); })
      .catch(() => { if (!cancelled) setTopic(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bankFile]);

  const all = useMemo(() => {
    if (!topic) return [];
    return (["easy", "medium", "hard"] as Difficulty[]).flatMap((d) => topic.by_difficulty[d] || []);
  }, [topic]);

  const q = search.trim().toLowerCase();
  const filtered = all.filter((m) => (diff === "all" || m.difficulty === diff) && (!q || m.question.toLowerCase().includes(q)));

  return (
    <div style={{ maxWidth: "none", paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".4px", color: C.muted }}>DIFFICULTY</span>
          <div style={{ display: "flex", gap: 6 }}>
            {DIFF_CHIPS.map((d) => {
              const on = diff === d;
              return (
                <div key={d} onClick={() => setDiff(d)} style={{ height: 32, padding: "0 13px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", color: on ? "#fff" : C.slate, background: on ? C.navy : "#fff", border: `1px solid ${on ? C.navy : "#E3E8ED"}` }}>
                  {d === "all" ? "All" : titleCase(d)}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <IconSearch s={14} stroke={C.muted} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
          <HInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions…" style={{ width: "100%", height: 36, border: "1.5px solid #E3E8ED", borderRadius: 9, padding: "0 11px 0 32px", fontSize: 12.5, color: C.navy, background: "#fff" }} focusStyle={{ borderColor: C.navy, outline: "none" }} />
        </div>
        <span style={{ fontSize: 12.5, color: C.muted, whiteSpace: "nowrap" }}>Showing <b style={{ color: C.slate, fontWeight: 700 }}>{filtered.length}</b> of {all.length}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((m, idx) => {
          const dd = diffStyle(m.difficulty);
          const opts = optView(m.options, m.correct_index, false, true);
          return (
            <div key={m.id} style={{ background: "#fff", border: "1.5px solid #E9EDF1", borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, background: "#F0F3F6", borderRadius: 6, padding: "3px 8px" }}>Q{idx + 1}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: dd.fg, background: dd.bg, borderRadius: 6, padding: "3px 9px" }}>{titleCase(m.difficulty)}</span>
                {m.type === "code" && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, background: "#F0F3F6", borderRadius: 6, padding: "3px 9px" }}>Code</span>}
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, lineHeight: 1.45 }}>{m.question}</div>
              {m.code && <pre className="mono" style={{ background: C.codeBg, borderRadius: 9, padding: "13px 15px", fontSize: 12.5, color: C.codeFg, lineHeight: 1.6, overflowX: "auto", marginTop: 11 }}>{m.code}</pre>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                {opts.map((o) => (
                  <div key={o.letter} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, fontSize: 13, color: o.fg, background: o.bg, border: `1px solid ${o.bd}` }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${o.dotBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: o.dotFg, fontSize: 11, fontWeight: 700 }}>{o.letter}</div>
                    {o.text}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: "center", color: C.faint, fontSize: 13, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14 }}>No questions match your filters.</div>}
        {loading && <div style={{ padding: 40, textAlign: "center" }}><Spinner size={18} /></div>}
      </div>
    </div>
  );
}
