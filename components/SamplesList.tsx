"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen, Braces, Code2, Eye, Play, Plus, Search, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AddSampleModal } from "@/components/AddSampleModal";
import { fetchCatalog } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SampleCatalogItem } from "@/lib/types";

interface Props {
  /** Pick a sample file for the create dialog. */
  onCreate: (filename: string) => void;
  /** Open the topic-browser modal for this filename. */
  onPreview: (filename: string) => void;
}

export function SamplesList({ onCreate, onPreview }: Props) {
  const [items, setItems] = useState<SampleCatalogItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    const data = await fetchCatalog();
    setItems(data.items);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(
      (i) =>
        i.topic.toLowerCase().includes(f) ||
        i.filename.toLowerCase().includes(f) ||
        i.languages.some((l) => l.includes(f)) ||
        (i.primary_language ?? "").includes(f) ||
        i.primary_type.includes(f),
    );
  }, [items, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-card/30 px-6 py-3">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by topic, language, type…"
              className="h-10 pl-10"
            />
          </div>
          {items && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} / {items.length}
            </span>
          )}
          <Link href="/generations">
            <Button variant="outline" size="sm">
              <Sparkles />
              Generated questions
            </Button>
          </Link>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            Add samples
          </Button>
        </div>
      </div>

      <AddSampleModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onUploaded={() => load()}
      />

      <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          {!items ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading catalog…</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No samples match.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="py-3 pl-6 text-left font-medium">Topic</th>
                    <th className="py-3 text-left font-medium">Type</th>
                    <th className="py-3 text-left font-medium">Language</th>
                    <th className="py-3 text-right font-medium">Questions</th>
                    <th className="py-3 pr-6 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <TopicRow
                      key={i.filename}
                      item={i}
                      onCreate={() => onCreate(i.filename)}
                      onPreview={() => onPreview(i.filename)}
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

function TopicRow({
  item, onCreate, onPreview,
}: {
  item: SampleCatalogItem;
  onCreate: () => void;
  onPreview: () => void;
}) {
  const code = item.primary_type === "code";
  return (
    <tr className="border-b transition-colors last:border-0 hover:bg-muted/40">
      <td className="py-3 pl-6">
        <div className="flex flex-col">
          <span className="font-medium">{item.topic}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{item.filename}</span>
        </div>
      </td>
      <td className="py-3">
        <Badge variant={code ? "default" : "secondary"} className="font-mono">
          {code ? <><Braces className="size-3" /> code</> : <><BookOpen className="size-3" /> general</>}
        </Badge>
      </td>
      <td className="py-3">
        {item.primary_language ? (
          <Badge variant="outline" className="font-mono">
            <Code2 className="size-3" /> {item.primary_language}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 text-right font-mono text-sm tabular-nums">{item.count}</td>
      <td className="py-3 pr-6">
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="outline" size="xs" onClick={onPreview} aria-label="View sample questions">
            <Eye />
            View
          </Button>
          <Button size="xs" onClick={onCreate} aria-label="Create new batch">
            <Play />
            Create
          </Button>
        </div>
      </td>
    </tr>
  );
}
