'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { bucketLabel } from './api';

// Orders over time (M16 order-overview): two series on one axis, orders placed and delivered. Colours are the
// validated reference slots 1 and 2 on the white card surface (blue, orange: CVD ΔE 24.7, contrast ≥ 3:1); text stays in
// the text tokens. 2px lines, markers only on hover, a quiet grid, a crosshair tooltip, a legend and end labels; the
// same numbers are in a table under the chart.

export const SERIES = [
  { key: 'orders', label: 'Orders placed', color: '#2a78d6' },
  { key: 'delivered', label: 'Delivered', color: '#eb6834' },
] as const;

interface Point {
  at: string;
  orders: number;
  delivered: number;
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  label?: unknown;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-input border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-text">{String(label ?? '')}</p>
      {SERIES.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <p key={s.key} className="flex items-center gap-2 text-muted">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold text-text tabular-nums">
              {Number(v ?? 0).toLocaleString('en-IN')}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function OrdersChart({ data, bucket }: { data: Point[]; bucket: 'hour' | 'day' }) {
  const rows = data.map((d) => ({ ...d, label: bucketLabel(d.at, bucket) }));
  const last = rows[rows.length - 1];
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
            {last ? (
              <span className="font-semibold text-text tabular-nums">
                {last[s.key].toLocaleString('en-IN')} {bucket === 'hour' ? 'this hour' : 'today'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#5b6474', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: '#5b6474', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              content={(p) => <TooltipBox active={p.active} payload={p.payload} label={p.label} />}
              cursor={{ stroke: '#d1d5db', strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted">Show as a table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Orders placed and delivered</caption>
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">{bucket === 'hour' ? 'Hour' : 'Day'}</th>
              {SERIES.map((s) => (
                <th key={s.key} className="py-1 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.at} className="border-t border-line">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{r.orders.toLocaleString('en-IN')}</td>
                <td className="py-1 text-right tabular-nums">
                  {r.delivered.toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
