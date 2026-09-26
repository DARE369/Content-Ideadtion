import { useEffect, useState } from "react";

const NAMES = ["--c-series-1", "--c-series-2", "--c-grid", "--c-ink-2", "--c-ink-3", "--c-surface", "--c-line", "--c-ink"] as const;
type Tokens = Record<(typeof NAMES)[number], string>;

function read(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((n) => [n, cs.getPropertyValue(n).trim()])) as Tokens;
}

/** Resolved design tokens for SVG charts, refreshed when the colour scheme flips. */
export function useTokens(): Tokens {
  const [t, setT] = useState<Tokens>(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setT(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return t;
}
