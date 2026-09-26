import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router";
import { api } from "../lib/api";
import type { BriefPayload, IdeaCard, Platform } from "../lib/types";
import { useWs } from "../lib/workspace";
import { LabelBadge, PlatformBadge } from "./bits";
import { Dialog } from "./Dialog";
import { Button, ErrorNote } from "./ui";

/** What Autopilot will send: the top shortlisted idea per connected platform, proven first. */
export function autopilotPlan(ideas: IdeaCard[], platforms: Platform[]): { platform: Platform; idea: IdeaCard }[] {
  return platforms.flatMap((platform) => {
    const best = ideas
      .filter((i) => i.platform === platform)
      .sort((a, b) => Number(b.label === "proven") - Number(a.label === "proven") || b.score - a.score)[0];
    return best ? [{ platform, idea: best }] : [];
  });
}

export function AutopilotDialog({ open, onClose, ideas, platforms }: { open: boolean; onClose: () => void; ideas: IdeaCard[]; platforms: Platform[] }) {
  const ws = useWs();
  const qc = useQueryClient();
  const plan = autopilotPlan(ideas, platforms);
  const run = useMutation({
    mutationFn: () => api.autopilot(ws),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws] }),
  });
  const close = () => { if (!run.isPending) { run.reset(); onClose(); } };
  const sent: BriefPayload[] = run.data?.briefs ?? [];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={run.isSuccess ? "This week's posts are on their way" : "Make this week's posts"}
      description={run.isSuccess ? undefined : "Autopilot sends the strongest idea for each of your platforms to your studio as a ready-to-shoot brief."}
      footer={run.isSuccess ? (
        <Button variant="primary" onClick={close}>Done</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="accent" loading={run.isPending} disabled={plan.length === 0} onClick={() => run.mutate()}>
            Send {plan.length} {plan.length === 1 ? "brief" : "briefs"}
          </Button>
        </>
      )}
    >
      {run.isSuccess ? (
        <ul className="flex flex-col gap-2">
          {sent.map((b) => (
            <li key={b.brief_id}>
              <Link to={`/briefs/${b.brief_id}`} onClick={close} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-surface-2">
                <CheckCircle2 className="size-4 text-good" aria-hidden />
                {b.platform && <PlatformBadge platform={b.platform} withName={false} />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.core_idea}</span>
                <ArrowRight className="size-4 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
          {sent.length === 0 && <p className="text-sm text-ink-2">Nothing was sent: there's no shortlisted idea for your connected platforms yet.</p>}
        </ul>
      ) : plan.length === 0 ? (
        <p className="text-sm text-ink-2">There are no shortlisted ideas for your connected platforms yet. Generate ideas first.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {plan.map(({ platform, idea }) => (
              <li key={platform} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2"><PlatformBadge platform={platform} /><LabelBadge label={idea.label} /></div>
                <p className="mt-1.5 text-sm font-medium">{idea.title}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">Most weeks this is all proven patterns; now and then one is a test, so you keep finding what works next.</p>
          {run.isError && <ErrorNote error={run.error} />}
        </div>
      )}
    </Dialog>
  );
}
