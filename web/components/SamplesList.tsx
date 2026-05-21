"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, Code2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fetchCatalog } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SampleCatalogItem } from "@/lib/types";

interface Props {
  /** The currently-selected filename (single-select). Empty string = none. */
  selected: string;
  /** Pick a sample file. */
  onSelect: (filename: string) => void;
}

export function SamplesList({ selected, onSelect }: Props) {
  const [items, setItems] = useState<SampleCatalogItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchCatalog();
      setItems(data.items);
    } finally {
      setLoading(false);
    }
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
        i.languages.some((l) => l.includes(f)),
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
              placeholder="Filter by topic, language, filename…"
              className="h-10 pl-10"
            />
          </div>
          {items && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} / {items.length}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          {!items ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading catalog…</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No samples match.</p>
          ) : (
            <div className="rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="py-3 pl-6 text-left font-medium">Topic</th>
                    <th className="py-3 text-left font-medium">File</th>
                    <th className="py-3 text-left font-medium">Languages</th>
                    <th className="py-3 text-right font-medium">Questions</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const on = selected === i.filename;
                    return (
                      <tr
                        key={i.filename}
                        onClick={() => onSelect(i.filename)}
                        className={cn(
                          "cursor-pointer border-b transition-colors last:border-0",
                          on ? "bg-accent" : "hover:bg-muted/50",
                        )}
                      >
                        <td className="py-3 pl-6">
                          <span className="font-medium">{i.topic}</span>
                        </td>
                        <td className="py-3 font-mono text-[11px] text-muted-foreground">
                          {i.filename}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {i.languages.length === 0 ? (
                              <Badge variant="outline">general</Badge>
                            ) : (
                              i.languages.map((l) => (
                                <Badge key={l} variant="secondary">{l}</Badge>
                              ))
                            )}
                            {i.has_code && (
                              <Badge variant="outline">
                                <Code2 className="size-3" /> code
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono text-xs">{i.count}</td>
                        <td className="py-3 pr-6 text-right text-muted-foreground">
                          <ChevronRight className="ml-auto size-4 opacity-40" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
