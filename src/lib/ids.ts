import { ulid } from "ulid";

export type IdPrefix =
  | "wsp" | "acc" | "cmp" | "cpp" | "sig" | "cmt" | "ide" | "brf"
  | "pst" | "rpt" | "rul" | "run" | "ast"
  | "src" | "scn" | "pag" | "kc" | "prd" | "upl" | "obj" | "cpg";

/** Prefixed, sortable ids, e.g. `brf_01J...`, matching the brief contract. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
