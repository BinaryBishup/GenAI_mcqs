"use client";

import { useMemo, useState } from "react";
import { C, titleCase } from "./theme";
import { HBtn, HBox, HInput, HTextarea } from "./ui";
import { IconBank, IconCheck, IconChevLeft, IconFolder, IconLock, IconPlus, IconSearch, IconSpark, IconTrash, IconX } from "./icons";
import { useAssessly } from "./store";
import type { Difficulty, GenerateRequest, Language, MCQType, SampleCatalogItem } from "@/lib/types";

// Quality checks mirror the real QUALITY_RULES ids in lib/prompts.ts.
const CHECKS: { id: string; label: string }[] = [
  { id: "length-parity", label: "Match option lengths" },
  { id: "plausible-distractors", label: "Plausible distractors" },
  { id: "parallel-structure", label: "Parallel option structure" },
  { id: "no-giveaway-words", label: "No giveaway words" },
  { id: "no-all-of-above", label: "No All / None of the above" },
  { id: "single-correct-answer", label: "Single defensibly-correct answer" },
];

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

interface Item {
  filename: string;
  name: string;
  chain: string;
  count: number;
  diff: Difficulty;
}

const DIFF_COLORS: Record<Difficulty, string> = { easy: "#4C8A28", medium: "#B0700C", hard: "#C0454B" };

/** Pick a sensible default difficulty for a bank: medium if it has any, else
 *  the first available difficulty. */
function defaultDiff(it: SampleCatalogItem): Difficulty {
  if (it.difficulties.includes("medium")) return "medium";
  return (it.difficulties[0] as Difficulty) ?? "medium";
}

export function GenerateModal() {
  const { genOpen, setGenOpen, catalog, startRun, toast } = useAssessly();

  const [phase, setPhase] = useState<"content" | "instr">("content");
  const [tab, setTab] = useState<"local" | "admin">("local");
  const [navPath, setNavPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);

  const [addPrompt, setAddPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [checks, setChecks] = useState<Set<string>>(new Set(CHECKS.map((c) => c.id)));

  const byFilename = useMemo(() => new Map(catalog.map((c) => [c.filename, c])), [catalog]);
  const folders = useMemo(() => {
    const map = new Map<string, SampleCatalogItem[]>();
    for (const it of catalog) {
      const key = it.topic || "Uncategorised";
      (map.get(key) || map.set(key, []).get(key)!).push(it);
    }
    return map;
  }, [catalog]);

  if (!genOpen) return null;

  const reset = () => {
    setPhase("content"); setTab("local"); setNavPath([]); setSearch("");
    setItems([]); setAddPrompt(""); setNegPrompt(""); setChecks(new Set(CHECKS.map((c) => c.id)));
  };
  const close = () => { setGenOpen(false); reset(); };

  const total = items.reduce((t, it) => t + it.count, 0);
  const addedFiles = new Set(items.map((i) => i.filename));

  const addBank = (it: SampleCatalogItem) => {
    if (addedFiles.has(it.filename)) return;
    const diff = defaultDiff(it);
    const cap = it.by_difficulty[diff] || 10;
    setItems((p) => [...p, { filename: it.filename, name: it.filename, chain: it.topic, count: Math.min(10, Math.max(1, cap)), diff }]);
  };
  const removeItem = (file: string) => setItems((p) => p.filter((i) => i.filename !== file));
  const setItemDiff = (file: string, d: Difficulty) => setItems((p) => p.map((i) => (i.filename === file ? { ...i, diff: d } : i)));
  const bumpItem = (file: string, delta: number) => setItems((p) => p.map((i) => (i.filename === file ? { ...i, count: Math.max(1, Math.min(50, i.count + delta)) } : i)));

  // explorer rows
  const q = search.trim().toLowerCase();
  let treeFolders: { name: string; count: number }[] = [];
  let treeBanks: SampleCatalogItem[] = [];
  if (q) {
    treeBanks = catalog.filter((it) => (it.filename + " " + it.topic).toLowerCase().includes(q));
  } else if (navPath.length === 0) {
    treeFolders = [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({ name, count: list.length }));
  } else {
    treeBanks = folders.get(navPath[0]) || [];
  }

  function buildRequest(): GenerateRequest | null {
    if (!items.length) return null;
    const count = total;
    const diffCount: Record<string, number> = {};
    items.forEach((i) => (diffCount[i.diff] = (diffCount[i.diff] || 0) + 1));
    const difficulty = (Object.entries(diffCount).sort((a, b) => b[1] - a[1])[0]?.[0] as Difficulty) || "medium";
    const sampleFiles = [...new Set(items.map((i) => i.filename))];
    const catItems = catalog.filter((c) => sampleFiles.includes(c.filename));
    const codeCount = catItems.filter((c) => c.primary_type === "code").length;
    const mcq_type: MCQType = codeCount > catItems.length / 2 ? "code" : "general";
    const langs = catItems.map((c) => c.primary_language).filter(Boolean) as Language[];
    return {
      count,
      topic: catItems[0]?.topic || sampleFiles[0],
      difficulty,
      mcq_type,
      languages: mcq_type === "code" ? [...new Set(langs)] : [],
      samples: [],
      sample_files: sampleFiles,
      samples_per_file: 4,
      max_revamp_attempts: 3,
      quality: "balanced",
      extra_prompt: addPrompt.trim() || undefined,
      negative_prompt: negPrompt.trim() || undefined,
      quality_rules: [...checks],
      grounding: true,
      mode: "sample",
      bank_specs: items.map((i) => ({ file: i.filename, difficulty: i.diff, count: i.count })),
    };
  }

  const runGenerate = () => {
    const req = buildRequest();
    if (!req) { toast("Add at least one bank to generate"); return; }
    startRun(req);
    toast(`${total} questions queued — generation started`);
    reset();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: "5vh 4vw" }}>
      <div style={{ width: "92vw", maxWidth: 1400, height: "90vh", background: "#fff", borderRadius: 18, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 28px", borderBottom: "1px solid #EDF1F4", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center" }}><IconSpark s={18} stroke={C.navy} sw={1.6} /></div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Generate MCQ questions</div>
              <div style={{ fontSize: 12.5, color: C.muted }}>{phase === "content" ? "Step 1 of 2 · Pick banks and difficulty" : "Step 2 of 2 · Instructions & quality checks"}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Stepper phase={phase} />
            <HBox onClick={close} style={{ width: 34, height: 34, borderRadius: 9, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} hover={{ background: "#E9EDF1" }}><IconX s={16} stroke={C.slate} /></HBox>
          </div>
        </div>

        {phase === "content" ? (
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {/* LEFT explorer: Local / Admin */}
            <div style={{ width: "46%", borderRight: "1px solid #EDF1F4", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", gap: 8, background: "#F4F6F8", padding: 5, borderRadius: 11, margin: "16px 24px 0" }}>
                {([["local", "Local banks"], ["admin", "Admin banks"]] as const).map(([k, label]) => {
                  const on = tab === k;
                  return <div key={k} onClick={() => setTab(k)} style={{ flex: 1, textAlign: "center", padding: 8, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: on ? C.navy : C.muted, background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 3px rgba(0,15,71,.1)" : "none" }}>{label}</div>;
                })}
              </div>

              {tab === "admin" ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: C.muted }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#EEF2F6", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><IconBank s={24} stroke={C.slate2} /></div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Mettl admin inventory</div>
                  <div style={{ fontSize: 12.5, marginTop: 6, maxWidth: 320, lineHeight: 1.5 }}>The shared admin banks will be selectable here once the Mettl admin API is connected.</div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 100, color: C.slate2, background: "#EEF1F5" }}><IconLock s={12} />Not connected yet</span>
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ padding: "14px 24px 10px", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <HBox onClick={() => setNavPath(navPath.slice(0, -1))} title="Back" style={{ display: "flex", alignItems: "center", gap: 6, height: 44, padding: "0 13px", borderRadius: 10, background: "#fff", border: `1.5px solid ${navPath.length ? C.navy : "#E3E8ED"}`, color: navPath.length ? C.navy : "#C8D2DC", fontSize: 12.5, fontWeight: 700, cursor: navPath.length ? "pointer" : "default", userSelect: "none", flexShrink: 0 }}><IconChevLeft s={14} sw={2} />Back</HBox>
                    <div style={{ position: "relative", flex: 1 }}>
                      <IconSearch s={16} stroke={C.muted} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }} />
                      <HInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your team's banks…" style={{ width: "100%", height: 44, border: "1.5px solid #E3E8ED", borderRadius: 10, padding: "0 14px 0 38px", fontSize: 13.5, color: C.navy, outline: "none" }} focusStyle={{ borderColor: C.navy }} />
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {treeFolders.map((fo) => (
                      <HBox key={fo.name} onClick={() => setNavPath([...navPath, fo.name])} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 10, cursor: "pointer", border: "1px solid #E9EDF1", background: "#fff" }} hover={{ borderColor: "#C8D2DC", background: "#FAFBFC" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 9, background: "#EEF2F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconFolder s={19} stroke={C.slate2} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{fo.name}</div><div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{fo.count} {fo.count === 1 ? "bank" : "banks"}</div></div>
                        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#A6B0BB" strokeWidth="2"><path d="M7 4l5 5-5 5" /></svg>
                      </HBox>
                    ))}
                    {treeBanks.map((b) => {
                      const added = addedFiles.has(b.filename);
                      return (
                        <div key={b.filename} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 10, border: "1px solid #E9EDF1", background: "#fff" }}>
                          <div style={{ width: 36, height: 36, borderRadius: 9, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconBank s={18} stroke={C.navy} /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.filename}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, display: "flex", gap: 8 }}>
                              <span style={{ color: DIFF_COLORS.easy }}>{b.by_difficulty.easy} Easy</span>
                              <span style={{ color: DIFF_COLORS.medium }}>{b.by_difficulty.medium} Med</span>
                              <span style={{ color: DIFF_COLORS.hard }}>{b.by_difficulty.hard} Hard</span>
                            </div>
                            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 2 }}>Uploaded by {b.uploaded_by || "—"}</div>
                          </div>
                          {added ? (
                            <HBox onClick={() => removeItem(b.filename)} title="Added · click to remove" style={{ width: 34, height: 34, borderRadius: 9, background: "#EEF6E2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }} hover={{ background: "#FCEBEC" }}><IconCheck s={15} stroke="#4C8A28" sw={2.4} /></HBox>
                          ) : (
                            <HBox onClick={() => addBank(b)} title="Add to generation" style={{ width: 34, height: 34, borderRadius: 9, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} hover={{ background: "#CFDBEC" }}><IconPlus s={16} stroke={C.navy} /></HBox>
                          )}
                        </div>
                      );
                    })}
                    {treeFolders.length === 0 && treeBanks.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>No banks here. Upload one from Question Banks → Local.</div>}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT composed */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "#FAFBFD" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px 14px", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Your generation</div>
                {items.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: C.navy, background: "#E1E8F4", borderRadius: 100, padding: "4px 11px" }}>{total} questions</span>}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 22px" }}>
                {items.length === 0 ? (
                  <div style={{ border: "1.5px dashed #D4DBE2", borderRadius: 13, padding: "48px 24px", textAlign: "center", color: C.muted, fontSize: 13.5, marginTop: 20 }}>No banks added yet.<br />Browse your team&apos;s banks on the left and add the ones you want.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {items.map((it) => {
                      const cat = byFilename.get(it.filename);
                      const available = cat?.difficulties ?? ["easy", "medium", "hard"];
                      const cap = cat?.by_difficulty[it.diff] ?? 50;
                      return (
                        <div key={it.filename} style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 12, padding: "13px 15px" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 11 }}>
                            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>{it.name}</div><div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cat ? `${cat.by_difficulty[it.diff]} ${titleCase(it.diff)} available` : it.chain}</div></div>
                            <HBox onClick={() => removeItem(it.filename)} title="Remove" style={{ width: 30, height: 30, borderRadius: 8, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} hover={{ background: "#FCEBEC" }}><IconTrash s={15} stroke="#C0454B" /></HBox>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: 5, flex: 1, minWidth: 200 }}>
                              {DIFFS.map((d) => {
                                const has = available.includes(d);
                                const on = it.diff === d;
                                const n = cat?.by_difficulty[d] ?? 0;
                                return (
                                  <div
                                    key={d}
                                    onClick={() => has && setItemDiff(it.filename, d)}
                                    title={has ? undefined : "This bank has no questions at this difficulty"}
                                    style={{ flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: has ? "pointer" : "not-allowed", color: !has ? "#C3C9D2" : on ? C.navy : C.slate, background: !has ? "#F7F8FA" : on ? "#E1E8F4" : "#fff", border: `1.5px solid ${!has ? "#EDF1F4" : on ? C.navy : "#E3E8ED"}`, opacity: has ? 1 : 0.7 }}
                                  >
                                    {titleCase(d)}<div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 1, color: !has ? "#C3C9D2" : DIFF_COLORS[d] }}>{n}</div>
                                  </div>
                                );
                              })}
                            </div>
                            <Counter small value={it.count} onDec={() => bumpItem(it.filename, -1)} onInc={() => bumpItem(it.filename, 1)} />
                          </div>
                          {it.count > cap && <div style={{ fontSize: 10.5, color: "#B0700C", marginTop: 7 }}>Only {cap} {titleCase(it.diff)} sample(s) — extra variants will reuse them.</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "32px 40px" }}>
            <div style={{ width: "100%", maxWidth: 980 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: C.navy, marginBottom: 6 }}>Instructions &amp; quality checks</h3>
              <p style={{ fontSize: 13.5, color: C.muted, marginBottom: 26 }}>Fine-tune how the AI writes the {total} questions across your selected banks.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 40 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Additional instructions <span style={{ color: C.faint, fontWeight: 500 }}>(optional)</span></label>
                  <HTextarea value={addPrompt} onChange={(e) => setAddPrompt(e.target.value)} placeholder="e.g. Use real-world scenarios; keep stems concise; vary the position of the correct answer." style={{ width: "100%", height: 118, border: "1.5px solid #E3E8ED", borderRadius: 12, padding: "13px 15px", fontSize: 13.5, color: C.navy, lineHeight: 1.55, outline: "none" }} focusStyle={{ borderColor: C.navy }} />
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", margin: "20px 0 8px" }}>Negative prompt <span style={{ color: C.faint, fontWeight: 500 }}>(avoid)</span></label>
                  <HTextarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} placeholder="e.g. No trick questions; avoid deprecated APIs; no ambiguous wording." style={{ width: "100%", height: 96, border: "1.5px solid #E3E8ED", borderRadius: 12, padding: "13px 15px", fontSize: 13.5, color: C.navy, lineHeight: 1.55, outline: "none" }} focusStyle={{ borderColor: C.navy }} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", marginBottom: 14 }}>Quality checks <span style={{ color: C.faint, fontWeight: 500 }}>· applied while generating</span></label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                    {CHECKS.map((c) => {
                      const on = checks.has(c.id);
                      return (
                        <div key={c.id} onClick={() => setChecks((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                          <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: on ? C.navy : "#fff", border: `1.5px solid ${on ? C.navy : "#CDD5DD"}` }}>{on && <IconCheck s={12} stroke="#fff" sw={2.4} />}</div>
                          <span style={{ fontSize: 13.5, color: C.slate, fontWeight: 600 }}>{c.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderTop: "1px solid #EDF1F4", background: "#fff", flexShrink: 0 }}>
          {phase === "content" ? (
            <>
              <div />
              <HBtn onClick={() => { if (!items.length) { toast("Add at least one bank to continue"); return; } setPhase("instr"); }} style={{ height: 46, padding: "0 22px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} hover={{ background: C.navyHover }}>Continue<svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l5 5-5 5" /></svg></HBtn>
            </>
          ) : (
            <>
              <HBtn onClick={() => setPhase("content")} style={{ height: 46, padding: "0 18px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}><IconChevLeft s={15} sw={2} />Back</HBtn>
              <HBtn onClick={runGenerate} style={{ height: 46, padding: "0 22px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 18px rgba(0,15,71,.26)" }} hover={{ background: C.navyHover }}><IconSpark s={16} sw={1.7} />Generate {total} questions</HBtn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ phase }: { phase: "content" | "instr" }) {
  const on2 = phase === "instr";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 22, height: 22, borderRadius: "50%", background: C.navy, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>1</div><span style={{ fontSize: 12.5, fontWeight: 700, color: C.navy }}>Banks</span></div>
      <div style={{ width: 26, height: 2, background: "#E3E8ED" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 22, height: 22, borderRadius: "50%", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", background: on2 ? C.navy : "#E3E8ED", color: on2 ? "#fff" : C.muted }}>2</div><span style={{ fontSize: 12.5, fontWeight: 700, color: on2 ? C.navy : C.muted }}>Instructions</span></div>
    </div>
  );
}

function Counter({ value, onDec, onInc, small }: { value: number; onDec: () => void; onInc: () => void; small?: boolean }) {
  const btn = small ? 26 : 30;
  return (
    <div style={{ display: "flex", alignItems: "center", border: "1.5px solid #E3E8ED", borderRadius: small ? 9 : 10, padding: small ? 3 : 4, flexShrink: 0 }}>
      <div onClick={onDec} style={{ width: btn, height: btn, borderRadius: small ? 6 : 7, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: small ? 16 : 18, color: C.slate, userSelect: "none" }}>−</div>
      <span style={{ fontSize: small ? 14 : 16, fontWeight: 800, color: C.navy, width: small ? 34 : 40, textAlign: "center" }}>{value}</span>
      <div onClick={onInc} style={{ width: btn, height: btn, borderRadius: small ? 6 : 7, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: small ? 16 : 18, color: C.slate, userSelect: "none" }}>+</div>
    </div>
  );
}
