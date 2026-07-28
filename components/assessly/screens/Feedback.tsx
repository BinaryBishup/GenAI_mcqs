"use client";

// Feedback — collect ratings + comments from users and store them server-side
// (feedback table, team-stamped). Shows the team's recent feedback below the
// form so people can see what's already been raised.

import { useEffect, useState } from "react";
import { C } from "../theme";
import { HBox, HBtn, HTextarea, Spinner } from "../ui";
import { useAssessly } from "../store";
import { fetchFeedback, submitFeedback, type FeedbackCategory, type FeedbackItem } from "@/lib/api";

const CATEGORIES: { key: FeedbackCategory; label: string; hint: string }[] = [
  { key: "general", label: "General", hint: "Anything on your mind" },
  { key: "quality", label: "Question quality", hint: "The generated content itself" },
  { key: "bug", label: "Bug", hint: "Something broke or misbehaved" },
  { key: "feature", label: "Feature request", hint: "Something you wish existed" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

function Star({ filled, onClick, onHover }: { filled: boolean; onClick: () => void; onHover: (h: boolean) => void }) {
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ cursor: "pointer", display: "inline-flex", padding: 2 }}
    >
      <svg width="30" height="30" viewBox="0 0 24 24" fill={filled ? "#E8A317" : "none"} stroke={filled ? "#E8A317" : C.faint} strokeWidth="1.6">
        <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
      </svg>
    </span>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? "" : "s"} ago`;
}

export function Feedback() {
  const { toast } = useAssessly();
  const [category, setCategory] = useState<FeedbackCategory>("general");
  const [rating, setRating] = useState<number>(0);
  const [hovered, setHovered] = useState<number>(0);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchFeedback()
      .then((f) => alive && setItems(f))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const saved = await submitFeedback({ category, rating: rating || null, message: message.trim(), page: "feedback" });
      setItems((prev) => [saved, ...(prev ?? [])]);
      setMessage("");
      setRating(0);
      setCategory("general");
      toast("Thanks — your feedback has been recorded.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send feedback — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {/* ---- the form ---- */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.navy }}>Tell us what you think</div>
        <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 18 }}>
          Goes straight to the product team, stamped with your team so we can follow up.
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>What is it about?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          {CATEGORIES.map((c) => {
            const on = category === c.key;
            return (
              <HBtn
                key={c.key}
                onClick={() => setCategory(c.key)}
                title={c.hint}
                style={{
                  padding: "9px 16px",
                  borderRadius: 100,
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: on ? `1.5px solid ${C.navy}` : `1.5px solid ${C.border2}`,
                  background: on ? C.navy : "#fff",
                  color: on ? "#fff" : C.slate,
                }}
                hover={on ? undefined : { borderColor: C.navy, color: C.navy }}
              >
                {c.label}
              </HBtn>
            );
          })}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>How is the product overall?</div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} filled={n <= (hovered || rating)} onClick={() => setRating(n === rating ? 0 : n)} onHover={(h) => setHovered(h ? n : 0)} />
          ))}
          <span style={{ fontSize: 13, color: C.muted, marginLeft: 10 }}>
            {rating ? ["", "Poor", "Fair", "Good", "Very good", "Excellent"][rating] : "Optional"}
          </span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Your feedback</div>
        <HTextarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What worked, what didn't, what you'd change… the more specific, the more useful."
          style={{ width: "100%", minHeight: 120, resize: "vertical", padding: "12px 14px", fontSize: 14.5, lineHeight: 1.6, color: C.ink, background: C.panel, border: `1.5px solid ${C.border2}`, borderRadius: 11, outline: "none", fontFamily: "inherit" }}
          focusStyle={{ borderColor: C.navy, background: "#fff" }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <HBtn
            onClick={send}
            disabled={!message.trim() || sending}
            style={{ height: 42, padding: "0 22px", borderRadius: 10, border: "none", background: message.trim() && !sending ? C.navy : "#C3CCD9", color: "#fff", fontSize: 14, fontWeight: 700, cursor: message.trim() && !sending ? "pointer" : "default", display: "flex", alignItems: "center", gap: 9 }}
            hover={message.trim() && !sending ? { background: C.navyHover } : undefined}
          >
            {sending && <Spinner size={12} color="#fff" track="rgba(255,255,255,.35)" />}
            {sending ? "Sending…" : "Send feedback"}
          </HBtn>
        </div>
      </div>

      {/* ---- the team's recent feedback ---- */}
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase", padding: "26px 4px 9px" }}>
        Recent feedback from your team
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 30 }}>
        {items === null ? (
          <div style={{ padding: 22, display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 14 }}>
            <Spinner size={12} /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 22, color: C.muted, fontSize: 14 }}>Nothing yet — yours will be the first.</div>
        ) : (
          items.map((f, i) => (
            <HBox key={f.id} style={{ padding: "15px 18px", borderTop: i ? `1px solid ${C.rowLine}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>{f.user_name ?? "Someone"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.slate2, background: C.blueChip, border: `1px solid ${C.blueChipBd}`, borderRadius: 100, padding: "1px 9px" }}>
                  {CATEGORY_LABEL[f.category] ?? f.category}
                </span>
                {f.rating ? (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#B07E0F" }}>{"★".repeat(f.rating)}</span>
                ) : null}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.faint }}>{timeAgo(f.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: C.slate, whiteSpace: "pre-wrap" }}>{f.message}</div>
            </HBox>
          ))
        )}
      </div>
    </div>
  );
}
