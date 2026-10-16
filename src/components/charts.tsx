"use client";
/**
 * Single-series charts (one hue: brand action blue). Every chart has a hover
 * tooltip and a collapsible data table, so values are never conveyed by
 * colour or geometry alone.
 */
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";

const SERIES = "#2857FC";
const GRID = "#EEF0F3";
const AXIS = "#6D7885";

export interface Datum {
  label: string;
  value: number;
  n?: number;
}

function DataTable({ data, valueLabel }: { data: Datum[]; valueLabel: string }) {
  const { t } = useI18n();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">{t.common.details}</summary>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 font-medium">{t.common.name}</th>
            <th className="py-1 text-right font-medium">{valueLabel}</th>
            <th className="py-1 text-right font-medium">n</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {data.map((d) => (
            <tr key={d.label} className="border-t border-line">
              <td className="py-1">{d.label}</td>
              <td className="py-1 text-right">{d.value}</td>
              <td className="py-1 text-right">{d.n ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function TooltipBox({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ value: number; payload: Datum }>; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm shadow-[var(--shadow-pop)]">
      <p className="font-medium text-ink">{label}</p>
      <p className="tabular text-muted">
        {d.value}
        {unit}
        {d.payload.n !== undefined ? ` · n = ${d.payload.n}` : ""}
      </p>
    </div>
  );
}

export function ColumnChart({ data, unit = "%", max = 100, valueLabel, height = 260 }: { data: Datum[]; unit?: string; max?: number; valueLabel: string; height?: number }) {
  return (
    <div>
      <div style={{ height }} role="img" aria-label={valueLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 12 }} interval={0} />
            <YAxis domain={[0, max]} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} allowDecimals={false} />
            <Tooltip cursor={{ fill: "#F4F6FF" }} content={<TooltipBox unit={unit} />} />
            <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}

export function HorizontalBarChart({ data, unit = "%", max = 100, valueLabel }: { data: Datum[]; unit?: string; max?: number; valueLabel: string }) {
  const height = Math.max(120, data.length * 36 + 40);
  return (
    <div>
      <div style={{ height }} role="img" aria-label={valueLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" domain={[0, max]} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fill: "#212121", fontSize: 12 }} />
            <Tooltip cursor={{ fill: "#F4F6FF" }} content={<TooltipBox unit={unit} />} />
            <Bar dataKey="value" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}

export function TrendChart({ data, unit = "%", valueLabel }: { data: Datum[]; unit?: string; valueLabel: string }) {
  return (
    <div>
      <div style={{ height: 240 }} role="img" aria-label={valueLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: AXIS, fontSize: 12 }} />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: AXIS, fontSize: 12 }} />
            <Tooltip cursor={{ stroke: AXIS, strokeWidth: 1 }} content={<TooltipBox unit={unit} />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={SERIES}
              strokeWidth={2}
              dot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: SERIES, stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}
