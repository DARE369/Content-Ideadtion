import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, num, shortDate } from "../lib/format";
import { useTokens } from "../lib/useTokens";

type Series = { key: string; name: string; color: "--c-series-1" | "--c-series-2" };

interface TipProps { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string | number }

function ChartTooltip({ active, payload, label, series, format, labelFormat }: TipProps & { series: Series[]; format: (n: number) => string; labelFormat: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{labelFormat(String(label))}</p>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <p key={s.key} className="flex items-center gap-2 text-ink-2">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} aria-hidden />
            {s.name}: <span className="font-semibold text-ink tabular-nums">{format(p.value)}</span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Line chart over weeks/snapshots. Thin 2px lines, recessive grid, a legend when
 * there's more than one series, and a table view for accessibility.
 */
export function TrendChart<T extends Record<string, unknown>>({ data, x, series, format = num, xFormat = shortDate, height = 240, title, yDomain }: {
  data: T[]; x: keyof T & string; series: Series[]; format?: (n: number) => string; xFormat?: (v: string) => string;
  height?: number; title: string; yDomain?: [number, number];
}) {
  const t = useTokens();
  const [table, setTable] = useState(false);
  return (
    <figure>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-4 text-xs text-ink-2" aria-label="Legend">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: t[s.color] }} aria-hidden />{s.name}</li>
            ))}
          </ul>
        ) : <span />}
        <button onClick={() => setTable((v) => !v)} className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline" aria-pressed={table}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
              <tr><th className="px-3 py-2 font-medium">{x === "week" ? "Week of" : "When"}</th>{series.map((s) => <th key={s.key} className="px-3 py-2 text-right font-medium">{s.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((d, i) => (
                <tr key={i}><td className="px-3 py-1.5">{xFormat(String(d[x]))}</td>{series.map((s) => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{d[s.key] == null ? "—" : format(Number(d[s.key]))}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={title} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={t["--c-grid"]} />
              <XAxis dataKey={x as never} tickFormatter={(v) => xFormat(String(v))} tick={{ fill: t["--c-ink-3"], fontSize: 11 }} axisLine={{ stroke: t["--c-line"] }} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={(v) => (format === num ? compact(v) : format(v))} tick={{ fill: t["--c-ink-3"], fontSize: 11 }} axisLine={false} tickLine={false} width={44} domain={yDomain} />
              <Tooltip cursor={{ stroke: t["--c-ink-3"], strokeDasharray: "3 3" }}
                content={<ChartTooltip series={series} format={format} labelFormat={xFormat} />} />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={t[s.color]} strokeWidth={2}
                  dot={data.length <= 8 ? { r: 4, strokeWidth: 2, stroke: t["--c-surface"], fill: t[s.color] } : false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: t["--c-surface"] }} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
