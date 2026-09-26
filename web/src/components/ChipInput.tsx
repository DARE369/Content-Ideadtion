import { X } from "lucide-react";
import { useState } from "react";
import { inputClass } from "./ui";

/**
 * Type and press Enter (or comma) to add; Backspace on empty removes the last one.
 * `sentences` is for whole questions: commas are kept and items stack as a list.
 */
export function ChipInput({ id, values, onChange, placeholder, max, sentences = false }: {
  id: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; sentences?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = max != null && values.length >= max;
  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !values.includes(v) && !full) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <ul className={sentences ? "flex flex-col gap-1.5" : "flex flex-wrap gap-1.5"} aria-label="Added">
          {values.map((v) => (
            <li key={v} className={`${sentences ? "flex justify-between" : "inline-flex"} items-center gap-1 rounded-md bg-surface-2 py-1 pl-2.5 pr-1 text-sm`}>
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`Remove ${v}`}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className={inputClass}
        value={draft}
        disabled={full}
        placeholder={full ? `Maximum of ${max} reached` : placeholder}
        onChange={(e) => (!sentences && e.target.value.endsWith(",") ? (setDraft(e.target.value), setTimeout(add)) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}
