import { anthropic } from "./anthropic";

/**
 * Diagram-as-code. Decide whether a single MCQ genuinely benefits from a visual
 * and, if so, have Claude emit ONE self-contained inline SVG for it. This is NOT
 * a diffusion model — the SVG is plain text we render directly. Most questions
 * (pure text / math / concept) need no diagram and return null.
 *
 * Also supports REVISION: given the current SVG + a natural-language
 * instruction, return an updated SVG (never NONE).
 *
 * Best-effort by contract: any error (model failure, no SVG in the response,
 * malformed output) resolves to null so the caller can skip the image without
 * failing the run.
 */

// The legibility rules are the important part — diffusion-free SVGs are only
// useful if every label is readable and nothing is occluded.
const SVG_RULES = `Requirements for the SVG:
- A single <svg>...</svg> element with viewBox set, width <= 640, and generous padding (>= 16px) so nothing touches the edges.
- LEGIBILITY IS CRITICAL — no text may be hidden, clipped, or overlap another element:
  - PAINT ORDER: draw ALL shapes, boxes, lines and arrows FIRST, then draw EVERY <text> element LAST so labels always sit on top.
  - Give every label clear space. For any label that sits on or near a line/arrow/edge, draw a small filled background rect (fill #ffffff, no stroke) behind the text first, so the line never crosses the glyphs.
  - Size every box/node to comfortably fit its label with padding; never let text spill outside its shape or get cropped. If a label is long, enlarge the shape or wrap onto two <text> lines — do NOT shrink it until it overflows.
  - Center node labels with text-anchor="middle" and dominant-baseline="middle". Place sub-labels (e.g. "Level 1") clearly BELOW their node with >= 8px gap, never overlapping edges.
  - Keep adequate spacing between nodes so connectors don't run through other nodes' labels.
  - Use font-size >= 12 for labels; never rely on tiny truncated text inside cramped cells.
- No external references, no <script>, no <image href>, no <foreignObject>, no CSS @import.
- Neutral palette: navy (#000f47) strokes/text, light fills (#f4f6f8, #ffffff); a single accent (#7AB52C or #E08A2B) is fine for highlights.`;

const DECIDE_HEADER = `You are deciding whether a multiple-choice question needs a diagram, and if so, drawing it.

MOST questions do NOT need a diagram. Pure text, math, definitions, code-reading, and conceptual questions must return NONE. ONLY produce a diagram when the question genuinely references or is clarified by a visual, such as: a system/architecture diagram, a flowchart or process, a network topology, a geometry figure, a chart/graph, or a tree/table structure.

If — and only if — a diagram genuinely helps, output ONE self-contained inline SVG and nothing else.
${SVG_RULES}

If NO diagram is warranted, output exactly:
NONE

Here is the question:`;

function buildDecidePrompt(args: { question: string; options: string[]; difficulty: string; instruction?: string }): string {
  const opts = args.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  const extra = args.instruction?.trim() ? `\n\nExtra guidance for the diagram: ${args.instruction.trim()}` : "";
  return `${DECIDE_HEADER}

Difficulty: ${args.difficulty}
Question: ${args.question}
Options:
${opts}${extra}`;
}

function buildRevisePrompt(args: { question: string; options: string[]; existingSvg: string; instruction: string }): string {
  const opts = args.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  return `You are revising the SVG diagram for a multiple-choice question. Apply the requested change while keeping the diagram accurate for the question and fully self-contained. Output ONLY the complete revised <svg>...</svg> — no prose, no NONE.

${SVG_RULES}

Question: ${args.question}
Options:
${opts}

Requested change: ${args.instruction.trim()}

Current SVG:
${args.existingSvg}`;
}

/** Strip surrounding markdown ``` fences, if any. */
function stripFences(text: string): string {
  let t = text.trim();
  const opener = t.match(/^```(?:svg|xml|html)?\s*\n?/i);
  if (opener) {
    t = t.slice(opener[0].length);
    t = t.replace(/\s*```\s*$/, "");
  }
  return t.trim();
}

/** Extract the first <svg>...</svg> block, or null if none present. */
function extractSvg(text: string): string | null {
  const t = stripFences(text);
  const start = t.search(/<svg[\s>]/i);
  if (start === -1) return null;
  const endMatch = t.slice(start).match(/<\/svg\s*>/i);
  if (!endMatch || endMatch.index === undefined) return null;
  const end = start + endMatch.index + endMatch[0].length;
  return t.slice(start, end).trim();
}

/**
 * Generate (or revise) an inline SVG for a question.
 * - With `existingSvg` + `instruction`: revise the existing diagram (always returns an SVG).
 * - With `instruction` only: generate fresh, biased toward producing a diagram, guided by the instruction.
 * - Otherwise: decide whether a diagram is warranted (may return null).
 */
export async function generateDiagram(args: {
  question: string;
  options: string[];
  difficulty: string;
  model: string;
  instruction?: string;
  existingSvg?: string;
}): Promise<string | null> {
  try {
    const revising = !!(args.existingSvg && args.instruction?.trim());
    const content = revising
      ? buildRevisePrompt({ question: args.question, options: args.options, existingSvg: args.existingSvg!, instruction: args.instruction! })
      : buildDecidePrompt(args);
    const msg = await anthropic().messages.create({
      model: args.model,
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return extractSvg(text);
  } catch {
    return null;
  }
}
