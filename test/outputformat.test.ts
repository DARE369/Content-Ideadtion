import { describe, expect, it } from "vitest";
import { z } from "zod";
import { outputFormat } from "../src/ai/client.js";
import { AdapterOutput } from "../src/ai/prompts/briefs.js";
import { IdeatorOutput } from "../src/ai/prompts/ideation.js";

const enums = (node: unknown, out: unknown[][] = []): unknown[][] => {
  if (Array.isArray(node)) node.forEach((n) => enums(n, out));
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.enum)) out.push(n.enum);
    Object.values(n).forEach((v) => enums(v, out));
  }
  return out;
};

describe("structured output schemas", () => {
  it("enforce enum lists (the SDK transform drops them)", () => {
    const f = outputFormat(z.object({ a: z.enum(["x", "y"]), b: z.enum(["p", "q"]).nullable(), c: z.array(z.object({ d: z.enum(["m"]) })) }));
    expect(enums(f.schema)).toEqual([["x", "y"], ["p", "q"], ["m"]]);
  });

  it("covers the brief and ideation schemas", () => {
    const brief = enums(outputFormat(AdapterOutput).schema);
    expect(brief).toContainEqual(["question", "number", "how_to", "statement", "contrarian", "story"]);
    expect(enums(outputFormat(IdeatorOutput).schema).length).toBeGreaterThan(4);
  });

  it("a style outside the list falls back instead of failing the brief", () => {
    const f = outputFormat(z.object({ s: AdapterOutput.shape.optimization.shape.title_style }));
    expect(f.parse(JSON.stringify({ s: "listicle" }))).toEqual({ s: "statement" });
  });
});
