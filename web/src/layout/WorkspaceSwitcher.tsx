import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useSummary, useWorkspace } from "../lib/workspace";

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const { workspaceId, setWorkspace } = useWorkspace();
  const summary = useSummary();
  const list = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces, enabled: open });
  const nav = useNavigate();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-accent" aria-hidden>
          {(summary.data?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{summary.data?.name ?? "Workspace"}</span>
          <span className="block text-xs text-ink-3">Switch workspace</span>
        </span>
        <ChevronsUpDown className="size-4 text-ink-3" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 top-full z-40 mt-1 min-w-64 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {list.isLoading && <p className="px-3 py-2 text-sm text-ink-3">Loading…</p>}
          {list.data?.map((w) => (
            <button
              key={w.id}
              role="menuitem"
              onClick={() => { setWorkspace(w.id); setOpen(false); nav(w.brain_confirmed ? "/week" : "/setup"); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <Store className="size-4 text-ink-3" aria-hidden />
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === workspaceId && <Check className="size-4 text-accent" aria-label="Current" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            role="menuitem"
            onClick={() => { setOpen(false); qc.removeQueries({ queryKey: ["workspaces"] }); nav("/welcome"); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface-2"
          >
            <Plus className="size-4" aria-hidden /> New workspace or demo
          </button>
        </div>
      )}
    </div>
  );
}
