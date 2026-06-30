"use client";

import { useState } from "react";
import { C } from "./theme";
import { HBtn, HBox, HTextarea } from "./ui";
import { IconFile, IconPencil, IconSpark, IconTrash, IconUpload, IconX } from "./icons";
import { useAssessly } from "./store";
import type { Difficulty, GenerateRequest } from "@/lib/types";

type Diff = "Easy" | "Medium" | "Hard" | "Mixed";
const DIFFS: Diff[] = ["Easy", "Medium", "Hard", "Mixed"];
const TYPES = ["General", "Single choice", "Multiple choice", "True / False", "Code snippet"] as const;

function toDifficulty(d: Diff): Difficulty {
  if (d === "Easy") return "easy";
  if (d === "Hard") return "hard";
  return "medium";
}

export function ScratchModal() {
  const { scratchOpen, setScratchOpen, startRun, toast } = useAssessly();
  const [files, setFiles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [neg, setNeg] = useState("");
  const [diff, setDiff] = useState<Diff>("Medium");
  const [count, setCount] = useState(15);
  const [type, setType] = useState<(typeof TYPES)[number]>("General");
  const [images, setImages] = useState(false);

  if (!scratchOpen) return null;

  const reset = () => { setFiles([]); setPrompt(""); setNeg(""); setDiff("Medium"); setCount(15); setType("General"); setImages(false); };
  const close = () => { setScratchOpen(false); reset(); };

  const build = () => {
    if (!prompt.trim() && !files.length) { toast("Add a prompt or upload a file to build"); return; }
    const isCode = type === "Code snippet";
    const req: GenerateRequest = {
      count,
      topic: prompt.trim().slice(0, 80) || files[0] || "Custom question set",
      difficulty: toDifficulty(diff),
      mcq_type: isCode ? "code" : "general",
      languages: isCode ? ["python"] : [],
      samples: [],
      sample_files: [],
      samples_per_file: 4,
      max_revamp_attempts: 3,
      quality: "balanced",
      extra_prompt: prompt.trim() || undefined,
      negative_prompt: neg.trim() || undefined,
      quality_rules: undefined,
      grounding: true,
      create_images: images,
      mode: "scratch",
    };
    startRun(req);
    toast(`${count} questions queued — building from scratch`);
    reset();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: "5vh 4vw" }}>
      <div style={{ width: 880, maxWidth: "100%", maxHeight: "90vh", background: "#fff", borderRadius: 18, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 28px", borderBottom: "1px solid #EDF1F4", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center" }}><IconPencil s={18} stroke={C.navy} /></div>
            <div><div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Create questions from scratch</div><div style={{ fontSize: 12.5, color: C.muted }}>Describe what you need — AI writes the MCQs</div></div>
          </div>
          <HBox onClick={close} style={{ width: 34, height: 34, borderRadius: 9, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} hover={{ background: "#E9EDF1" }}><IconX s={16} stroke={C.slate} /></HBox>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.32fr 1fr", gap: 30, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", marginBottom: 9 }}>Source files <span style={{ color: C.faint, fontWeight: 500 }}>· optional context</span></label>
                <HBox onClick={() => { const n = `Reference ${files.length + 1}.pdf`; setFiles((f) => [...f, n]); toast("File ingestion is coming soon — the prompt drives generation for now"); }} style={{ border: "1.5px dashed #CDD7E2", borderRadius: 11, padding: 16, display: "flex", alignItems: "center", gap: 13, cursor: "pointer" }} hover={{ borderColor: C.navy, background: "#F7F9FC" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconUpload s={18} stroke={C.navy} /></div>
                  <div><div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Add files</div><div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>PDF, DOCX, PPTX or TXT · up to 25 MB</div></div>
                </HBox>
                {files.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid #E9EDF1", borderRadius: 9, background: "#FAFBFC" }}>
                        <IconFile s={16} stroke={C.navy} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f}</span>
                        <HBox onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} title="Remove" style={{ cursor: "pointer", width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F6F8" }} hover={{ background: "#FCEBEC" }}><IconX s={13} stroke="#C0454B" /></HBox>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Prompt</label>
                <HTextarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what the questions should cover — topics, scope, depth, audience…" style={{ width: "100%", height: 120, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "12px 14px", fontSize: 13.5, color: C.navy, lineHeight: 1.5, outline: "none" }} focusStyle={{ borderColor: C.navy }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Negative prompt <span style={{ color: C.faint, fontWeight: 500 }}>· avoid</span></label>
                <HTextarea value={neg} onChange={(e) => setNeg(e.target.value)} placeholder="e.g. No trick questions, avoid deprecated APIs, no ambiguous wording…" style={{ width: "100%", height: 84, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "12px 14px", fontSize: 13.5, color: C.navy, lineHeight: 1.5, outline: "none" }} focusStyle={{ borderColor: C.navy }} />
              </div>
            </div>

            <div style={{ background: "#FAFBFD", border: "1px solid #EDF1F4", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", color: C.slate2 }}>GENERATION SETTINGS</div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Difficulty</label>
                <div style={{ display: "flex", gap: 5 }}>
                  {DIFFS.map((d) => { const on = diff === d; return <div key={d} onClick={() => setDiff(d)} style={{ flex: 1, textAlign: "center", padding: "9px 2px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: on ? C.navy : C.slate, background: on ? "#E1E8F4" : "#fff", border: `1.5px solid ${on ? C.navy : "#E3E8ED"}` }}>{d}</div>; })}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Question type</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {TYPES.map((t) => { const on = type === t; return (
                    <div key={t} onClick={() => setType(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: "pointer", border: `1.5px solid ${on ? C.navy : "#E3E8ED"}`, background: on ? "#F8F8FD" : "#fff" }}>
                      <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${on ? C.navy : "#CDD5DD"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: on ? C.navy : "transparent" }} /></div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? C.navy : C.slate }}>{t}</span>
                    </div>
                  ); })}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>Number of questions</label>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1.5px solid #E3E8ED", borderRadius: 10, padding: "4px 6px", background: "#fff" }}>
                  <div onClick={() => setCount((c) => Math.max(5, c - 1))} style={{ width: 30, height: 30, borderRadius: 7, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: C.slate, userSelect: "none" }}>−</div>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>{count}</span>
                  <div onClick={() => setCount((c) => Math.min(50, c + 1))} style={{ width: 30, height: 30, borderRadius: 7, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, color: C.slate, userSelect: "none" }}>+</div>
                </div>
              </div>
              <div onClick={() => setImages((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", paddingTop: 2 }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 700, color: C.slate }}>Create images</div><div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Builds image-based questions with diagrams</div></div>
                <div style={{ width: 42, height: 24, borderRadius: 100, background: images ? C.navy : "#D4DBE2", position: "relative", transition: ".15s", flexShrink: 0 }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: images ? 21 : 3, transition: ".15s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} /></div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 26px", borderTop: "1px solid #EDF1F4", background: "#fff", flexShrink: 0 }}>
          <HBtn onClick={close} style={{ height: 46, padding: "0 18px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Cancel</HBtn>
          <HBtn onClick={build} style={{ height: 46, padding: "0 22px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 18px rgba(0,15,71,.26)" }} hover={{ background: C.navyHover }}><IconSpark s={16} sw={1.7} />Build {count} questions</HBtn>
        </div>
      </div>
    </div>
  );
}
