import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Narrated progress for long AI calls: steps advance on a timer so people see
 * what is happening, and the last step waits for the real result.
 */
export function NarratedProgress({ steps, intervalMs = 4000, done }: { steps: string[]; intervalMs?: number; done?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), intervalMs);
    return () => clearInterval(t);
  }, [steps.length, intervalMs, done]);
  return (
    <ol className="flex flex-col gap-3" aria-live="polite">
      {steps.map((s, n) => {
        const state = done || n < i ? "done" : n === i ? "active" : "todo";
        return (
          <li key={s} className={`flex items-center gap-3 text-sm ${state === "todo" ? "text-ink-3" : "text-ink"}`}>
            <span className={`grid size-6 place-items-center rounded-full ${state === "done" ? "bg-good-soft text-good" : state === "active" ? "bg-accent-soft text-accent" : "bg-surface-2"}`}>
              {state === "done" ? <Check className="size-3.5" aria-label="Done" /> : state === "active" ? <Loader2 className="size-3.5 animate-spin" aria-label="In progress" /> : <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />}
            </span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}
