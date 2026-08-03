"use client";

import { useRef, useState } from "react";
import { C, diffStyle, titleCase } from "./theme";
import { HBtn, HBox, HInput, Spinner } from "./ui";
import { IconCheck, IconFile, IconUpload, IconX } from "./icons";
import { previewSample, uploadSample, type UploadSampleResult } from "@/lib/api";
import type { Difficulty, SamplePreviewResult } from "@/lib/types";

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

/** Upload a Mettl .xls/.xlsx workbook into the current team's Local banks. Parse
 *  → preview → commit, mirroring the old AddSampleModal but SmartCoGen-styled. */
export function UploadBankModal({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: (r: UploadSampleResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [preview, setPreview] = useState<SamplePreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => { setFile(null); setTopic(""); setPreview(null); setError(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const pick = (f: File | null) => {
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) { setError("File must be a .xls or .xlsx workbook."); return; }
    setError(null);
    setFile(f);
    setPreview(null);
    setTopic(f.name.replace(/\.xlsx?$/i, "").trim());
  };

  const runPreview = async () => {
    if (!file || !topic.trim()) return;
    setBusy(true); setError(null);
    try {
      setPreview(await previewSample(file, topic.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the workbook.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file || !topic.trim()) { setError("Pick a file and a topic name."); return; }
    setBusy(true); setError(null);
    try {
      const res = await uploadSample(file, topic.trim());
      onUploaded(res);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 24 }}>
      <div style={{ width: 560, maxWidth: "100%", maxHeight: "90vh", background: "#fff", borderRadius: 18, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #EDF1F4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center" }}><IconUpload s={18} stroke={C.navy} /></div>
            <div><div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Upload to Local banks</div><div style={{ fontSize: 12.5, color: C.muted }}>Mettl .xls / .xlsx bulk-upload format · max 10 MB</div></div>
          </div>
          <HBox onClick={close} style={{ width: 34, height: 34, borderRadius: 9, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} hover={{ background: "#E9EDF1" }}><IconX s={16} stroke={C.slate} /></HBox>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <input ref={inputRef} type="file" accept=".xls,.xlsx" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />

          {!file ? (
            <HBox onClick={() => inputRef.current?.click()} style={{ border: "1.5px dashed #CDD7E2", borderRadius: 12, padding: "34px 20px", textAlign: "center", cursor: "pointer" }} hover={{ borderColor: C.navy, background: "#F7F9FC" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Choose a workbook</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>Click to select a .xls or .xlsx file</div>
            </HBox>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "1px solid #E9EDF1", borderRadius: 10, background: "#FAFBFC" }}>
                <IconFile s={17} stroke={C.navy} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
                <HBox onClick={() => { setFile(null); setPreview(null); }} title="Remove" style={{ cursor: "pointer", width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F6F8" }} hover={{ background: "#FCEBEC" }}><IconX s={13} stroke="#C0454B" /></HBox>
              </div>

              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", margin: "18px 0 8px" }}>Bank name</label>
              <HInput value={topic} onChange={(e) => { setTopic(e.target.value); setPreview(null); }} placeholder="e.g. Computer Networking — Set 2" style={{ width: "100%", height: 44, border: "1.5px solid #E3E8ED", borderRadius: 10, padding: "0 14px", fontSize: 14, color: C.navy, outline: "none" }} focusStyle={{ borderColor: C.navy }} />

              {!preview ? (
                <HBtn onClick={runPreview} disabled={busy || !topic.trim()} style={{ marginTop: 14, height: 42, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }} hover={{ borderColor: C.navy, color: C.navy }}>
                  {busy ? <Spinner size={14} /> : null}{busy ? "Reading…" : "Preview questions"}
                </HBtn>
              ) : (
                <div style={{ marginTop: 16, border: "1px solid #E9EDF1", borderRadius: 12, padding: "14px 16px", background: "#FAFBFD" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <IconCheck s={15} stroke="#4C8A28" sw={2.2} />
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>{preview.total} questions found</span>
                    <span style={{ fontSize: 12, color: C.muted }}>· {preview.code_count} code · {preview.general_count} general</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {DIFFS.map((d) => {
                      const n = (preview.by_difficulty?.[d] ?? []).length;
                      const dd = diffStyle(d);
                      return <span key={d} style={{ fontSize: 12, fontWeight: 700, color: dd.fg, background: dd.bg, borderRadius: 8, padding: "5px 10px" }}>{n} {titleCase(d)}</span>;
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div style={{ marginTop: 14, padding: "10px 13px", borderRadius: 10, background: "#FCEBEC", border: "1px solid #F2C4C8", color: "#C0454B", fontSize: 13, fontWeight: 600 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "16px 24px", borderTop: "1px solid #EDF1F4", background: "#FAFBFC" }}>
          <HBtn onClick={close} style={{ height: 44, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Cancel</HBtn>
          <HBtn onClick={commit} disabled={busy || !file || !topic.trim()} style={{ height: 44, padding: "0 20px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: busy || !file ? "default" : "pointer", opacity: busy || !file || !topic.trim() ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }} hover={{ background: C.navyHover }}>
            {busy ? <Spinner size={14} color="#fff" track="rgba(255,255,255,.4)" /> : <IconUpload s={15} />}{busy ? "Uploading…" : "Upload bank"}
          </HBtn>
        </div>
      </div>
    </div>
  );
}
