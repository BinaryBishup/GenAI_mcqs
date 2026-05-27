"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileJson,
  FileSpreadsheet, FileUp, Loader2, Search, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MCQCard } from "@/components/MCQCard";
import { fetchPastRuns, fetchRun, fetchRunResults } from "@/lib/api";
import { downloadMCQs, type DownloadFormat } from "@/lib/download";
import type { MCQ, PastRunSummary, RunStatus } from "@/lib/types";

export default function GenerationsPage() {
  const [runs, setRuns] = useState<PastRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Selected run → its loaded questions (detail view).
  const [selected, setSelected] = useState<PastRunSummary | null>(null);
  const [detail, setDetail] = useState<MCQ[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<RunStatus | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await fetchPastRuns();
      setRuns(d.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!runs) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return runs;
    return runs.filter(
      (r) =>
        r.topic.toLowerCase().includes(f) ||
        r.difficulty.toLowerCase().includes(f) ||
        r.mcq_type.toLowerCase().includes(f) ||
        r.quality.toLowerCase().includes(f) ||
        r.sample_file_ids.some((s) => s.toLowerCase().includes(f)),
    );
  }, [runs, filter]);

  async function download(run: PastRunSummary, format: DownloadFormat) {
    setBusyId(run.id);
    try {
      const data = await fetchRunResults(run.id);
      const qs = (data.questions ?? []).filter(Boolean);
      if (qs.length === 0) throw new Error("This run has no stored questions.");
      downloadMCQs(qs, format, run.topic);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  // Load + (while non-terminal) poll the selected run until it finishes. This is
  // the "catch it later" path: a run kicked off earlier — even from a tab you've
  // since closed — keeps writing to Supabase, so reopening it streams the
  // questions in as they land.
  useEffect(() => {
    if (!selected) return;
    const runId = selected.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TERMINAL = new Set<RunStatus>(["done", "error"]);

    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setDetailStatus(selected.status);

    async function tick() {
      try {
        const data = await fetchRun(runId);
        if (cancelled) return;
        setDetail(data.mcqs.filter(Boolean));
        setDetailStatus(data.run.status as RunStatus);
        setDetailLoading(false);
        if (!TERMINAL.has(data.run.status as RunStatus)) {
          timer = setTimeout(tick, 3000);
        } else {
          load(); // refresh the list so the row's status catches up too
        }
      } catch (e) {
        if (cancelled) return;
        setDetailError(e instanceof Error ? e.message : String(e));
        setDetailLoading(false);
      }
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [selected, load]);

  // ---- Detail view ---------------------------------------------------------
  if (selected) {
    return (
      <div className="flex h-screen flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-950/50 bg-blue-950 px-6 py-3 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
              className="text-white/90 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft />
              Back
            </Button>
            <div className="h-6 w-px bg-white/15" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{selected.topic}</p>
              <p className="mt-0.5 truncate text-[11px] text-white/60">
                {selected.count} × {selected.difficulty} {selected.mcq_type} · {selected.quality} ·{" "}
                {formatDate(selected.started_at)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {detailStatus && detailStatus !== "done" && detailStatus !== "error" && (
              <Badge
                variant="outline"
                className="gap-1.5 border-white/20 bg-white/5 normal-case tracking-normal text-white"
              >
                <Loader2 className="size-3 animate-spin" />
                {detail?.length ?? 0}/{selected.count}
              </Badge>
            )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={!detail || detail.length === 0}
                className="border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 disabled:text-white/40"
              >
                <Download />
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["json", "csv", "mettl"] as const).map((fmt) => (
                <DropdownMenuItem
                  key={fmt}
                  onClick={() => detail && downloadMCQs(detail, fmt, selected.topic)}
                >
                  {fmt === "json" && <FileJson />}
                  {fmt === "csv" && <FileSpreadsheet />}
                  {fmt === "mettl" && <FileUp />}
                  {fmt === "json" ? "JSON" : fmt === "csv" ? "CSV" : "Mettl bulk-upload (.xls)"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-[900px] space-y-4 px-6 py-6">
            {detailLoading && (
              <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading questions…
              </p>
            )}
            {detailError && <p className="py-10 text-center text-sm text-destructive">{detailError}</p>}
            {detail && detail.length === 0 && !detailLoading && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {detailStatus && detailStatus !== "done" && detailStatus !== "error"
                  ? "Generating… questions will appear here as they finish."
                  : "This run has no stored questions."}
              </p>
            )}
            {detail?.map((q, i) => <MCQCard key={q.id || i} mcq={q} index={i} />)}
          </div>
        </div>
      </div>
    );
  }

  // ---- List view -----------------------------------------------------------
  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-blue-950/50 bg-blue-950 text-white">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-md bg-white/10 text-white ring-1 ring-white/20">
              <Sparkles className="size-4" />
            </div>
            <h1 className="text-sm font-semibold text-white">Generated Questions</h1>
          </div>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-white/90 hover:bg-white/10 hover:text-white">
              <ArrowLeft />
              Samples
            </Button>
          </Link>
        </div>
      </header>

      <div className="border-b bg-card/30 px-6 py-3">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by topic, difficulty, type…"
              className="h-10 pl-10"
            />
          </div>
          {runs && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} / {runs.length}
            </span>
          )}
        </div>
      </div>

      <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          {error && (
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {!runs ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading generations…</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {runs.length === 0 ? "No generations yet — create one from the Samples page." : "No generations match."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-[230px]" />
                  <col className="w-[120px]" />
                  <col className="w-[110px]" />
                  <col className="w-[210px]" />
                </colgroup>
                <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="py-3 pl-6 text-left font-medium">Topic</th>
                    <th className="py-3 text-left font-medium">Config</th>
                    <th className="py-3 text-left font-medium">Status</th>
                    <th className="py-3 text-left font-medium">When</th>
                    <th className="py-3 pr-6 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <RunRow
                      key={r.id}
                      run={r}
                      busy={busyId === r.id}
                      onOpen={() => setSelected(r)}
                      onDownload={(fmt) => download(r, fmt)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RunRow({
  run, busy, onOpen, onDownload,
}: {
  run: PastRunSummary;
  busy: boolean;
  onOpen: () => void;
  onDownload: (fmt: DownloadFormat) => void;
}) {
  const done = run.status === "done";
  return (
    <tr className="border-b transition-colors last:border-0 hover:bg-muted/40">
      <td className="py-3 pl-6 pr-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{run.topic}</span>
          {run.sample_file_ids[0] && (
            <span className="truncate font-mono text-[10px] text-muted-foreground">{run.sample_file_ids[0]}</span>
          )}
          {run.error_message && (
            <span className="mt-0.5 block truncate text-[11px] text-destructive" title={run.error_message}>
              {run.error_message}
            </span>
          )}
        </div>
      </td>
      <td className="py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">{run.count} × {run.difficulty}</Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">{run.mcq_type}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">{run.quality}</Badge>
        </div>
      </td>
      <td className="py-3">
        <StatusBadge status={run.status} />
      </td>
      <td className="py-3 text-xs text-muted-foreground">{formatRelative(run.started_at)}</td>
      <td className="py-3 pr-6">
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="outline" size="xs" onClick={onOpen} disabled={run.status === "error"}>
            <Sparkles />
            View
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" disabled={!done || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Download />}
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDownload("json")}><FileJson />JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownload("csv")}><FileSpreadsheet />CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownload("mettl")}><FileUp />Mettl bulk-upload (.xls)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: PastRunSummary["status"] }) {
  if (status === "done") {
    return (
      <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">
        <CheckCircle2 className="size-3" /> done
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" /> error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="size-3 animate-spin" /> {status}
    </Badge>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
