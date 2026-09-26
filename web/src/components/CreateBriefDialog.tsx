import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { PLATFORM_META } from "../lib/format";
import type { IdeaCard, Platform } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";
import { PlatformBadge } from "./bits";
import { Dialog } from "./Dialog";
import { NarratedProgress } from "./Progress";
import { useToast } from "./Toast";
import { Button, ErrorNote } from "./ui";

/** Pick platforms (one native brief each), or none for one format-neutral general brief. */
export function CreateBriefDialog({ idea, onClose }: { idea: Pick<IdeaCard, "idea_id" | "title" | "platform"> | null; onClose: () => void }) {
  const ws = useWs();
  const summary = useSummary();
  const cfg = useAppConfig();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const connected = summary.data?.platforms ?? [];
  const options: Platform[] = connected.length ? connected : ["instagram", "tiktok", "youtube", "facebook", "linkedin"];
  const [picked, setPicked] = useState<Platform[]>([]);

  useEffect(() => {
    if (idea) setPicked(idea.platform ? [idea.platform] : []);
  }, [idea]);

  const create = useMutation({
    mutationFn: () => api.handoff(idea!.idea_id, picked),
    onSuccess: ({ briefs }) => {
      qc.invalidateQueries({ queryKey: ["ws", ws] });
      onClose();
      toast({ tone: "success", message: briefs.length === 1 ? "Brief sent to your studio." : `${briefs.length} briefs sent to your studio.` });
      nav(briefs.length === 1 ? `/briefs/${briefs[0]!.brief_id}` : "/briefs");
    },
  });

  const toggle = (p: Platform) => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const aiMissing = cfg.data && !cfg.data.ai_configured;

  return (
    <Dialog
      open={!!idea}
      onClose={() => { if (!create.isPending) { create.reset(); onClose(); } }}
      title="Create brief"
      description={idea?.title}
      footer={!create.isPending && (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={aiMissing ?? false}>
            {picked.length === 0 ? "Create general brief" : picked.length === 1 ? `Create ${PLATFORM_META[picked[0]!].name} brief` : `Create ${picked.length} briefs`}
          </Button>
        </>
      )}
    >
      {create.isPending ? (
        <div className="py-2">
          <NarratedProgress intervalMs={3000} steps={[
            ...(picked.length ? picked.map((p) => `Rebuilding it natively for ${PLATFORM_META[p].name}`) : ["Writing a format-neutral brief"]),
            "Adding hooks, beats, script and caption",
            "Sending to your studio",
          ]} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="text-sm font-medium">Which platforms?</legend>
            <p className="mt-0.5 text-xs text-ink-3">Each platform gets its own version built for how that platform ranks posts. It isn't the same script copied over.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {options.map((p) => {
                const on = picked.includes(p);
                return (
                  <button key={p} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p)}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${on ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2"}`}>
                    <PlatformBadge platform={p} />
                    <span className={`ml-auto grid size-5 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-line-strong"}`}>{on && <Check className="size-3.5" aria-hidden />}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button type="button" onClick={() => setPicked([])}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left ${picked.length === 0 ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2"}`}>
            <LayoutGrid className="mt-0.5 size-4 text-ink-3" aria-hidden />
            <span>
              <span className="block text-sm font-medium">No platform yet: general brief</span>
              <span className="block text-xs text-ink-3">The core idea, messaging, visual direction and 3 hooks, ready to adapt later.</span>
            </span>
          </button>
          {aiMissing && <p className="text-sm text-bad">Writing briefs needs an Anthropic API key on the server.</p>}
          {create.isError && <ErrorNote error={create.error} />}
        </div>
      )}
    </Dialog>
  );
}
