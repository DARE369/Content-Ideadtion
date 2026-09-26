import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { PLATFORM_META } from "../lib/format";
import type { Platform } from "../lib/types";
import { PlatformBadge } from "./bits";
import { useToast } from "./Toast";
import { Button, Field, inputClass, Skeleton } from "./ui";

const HANDLE_PLATFORMS: { platform: Platform; placeholder: string; note: string }[] = [
  { platform: "instagram", placeholder: "handle, without @", note: "Posts and likes via Instagram Business Discovery" },
  { platform: "youtube", placeholder: "@handle or channel ID", note: "Videos, views and comments" },
  { platform: "tiktok", placeholder: "handle", note: "Saved for later; TikTok has no free competitor data yet" },
];

export function CompetitorsEditor({ ws }: { ws: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["ws", ws, "competitors"], queryFn: () => api.competitors(ws) });
  const [name, setName] = useState("");
  const [handles, setHandles] = useState<Partial<Record<Platform, string>>>({});
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws", ws] });

  const add = useMutation({
    mutationFn: () => api.addCompetitor(ws, {
      name: name.trim(),
      handles: Object.fromEntries(Object.entries(handles).map(([k, v]) => [k, v?.trim().replace(/^@(?=[^@]*$)/, k === "youtube" ? "@" : "")]).filter(([, v]) => v)),
    }),
    onSuccess: () => { setName(""); setHandles({}); invalidate(); toast({ tone: "success", message: `${name.trim()} added. Their public posts are checked every night.` }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeCompetitor(ws, id),
    onSuccess: invalidate,
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  const count = list.data?.length ?? 0;
  const hasHandle = Object.values(handles).some((v) => v?.trim());

  return (
    <div className="flex flex-col gap-5">
      {list.isLoading ? <Skeleton className="h-16" /> : count > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.data!.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <div className="mt-1 flex flex-wrap gap-3">
                  {Object.entries(c.handles).map(([p, h]) => (
                    p === "website"
                      ? <span key={p} className="text-xs text-ink-3">{String(h).replace(/^https?:\/\/(www\.)?/, "")}</span>
                      : p in PLATFORM_META
                        ? <span key={p} className="inline-flex items-center gap-1.5 text-xs text-ink-2"><PlatformBadge platform={p as Platform} withName={false} size="sm" />{String(h).replace(/^https?:\/\/(www\.)?/, "")}</span>
                        : null
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" aria-label={`Remove ${c.name}`} loading={remove.isPending && remove.variables === c.id}
                onClick={() => remove.mutate(c.id)} icon={<Trash2 className="size-4" />} />
            </li>
          ))}
        </ul>
      )}

      {count < 5 ? (
        <form className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2/50 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <p className="text-sm font-medium">Add one yourself <span className="font-normal text-ink-3">({count} of 5 tracked)</span></p>
          <Field label="Name" htmlFor="cmp-name">
            <input id="cmp-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sugar Street Lagos" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            {HANDLE_PLATFORMS.map(({ platform, placeholder, note }) => (
              <Field key={platform} label={<PlatformBadge platform={platform} />} htmlFor={`cmp-${platform}`} hint={note}>
                <input id={`cmp-${platform}`} className={inputClass} placeholder={placeholder} value={handles[platform] ?? ""}
                  onChange={(e) => setHandles((h) => ({ ...h, [platform]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <Button type="submit" className="self-start" loading={add.isPending} disabled={!name.trim() || !hasHandle} icon={<Plus className="size-4" />}>
            Add competitor
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink-2">You're tracking the maximum of 5. Remove one to add another.</p>
      )}
    </div>
  );
}
