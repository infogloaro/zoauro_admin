'use client';

/**
 * Revenue trend area chart (Figma "Restaurant revenue trend"): orange line
 * with a translucent area fill over faint gridlines. Rendered as inline SVG
 * (no charting dependency is installed — doc 06 allows none).
 */
export function RevenueTrend({ points, labels }: { points: number[]; labels: string[] }) {
  const w = 600;
  const h = 200;
  const pad = 0.08; // keep the line off the card edges
  const coords = points.map((point, index) => {
    const x = points.length > 1 ? (index / (points.length - 1)) * w : 0;
    const clamped = Math.min(1, Math.max(0, point));
    const y = h - (pad + clamped * (1 - pad * 2)) * h;
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gridYs = [0, h / 3, (2 * h) / 3, h];

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-[210px] w-full"
        role="img"
        aria-label="Simulated monthly revenue trend, August to January"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f9531e" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f9531e" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridYs.map((y) => (
          <line
            key={y}
            x1="0"
            x2={w}
            y1={y}
            y2={y}
            stroke="#f2f4f7"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#trend-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#f9531e"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between px-1 pt-2 text-[11px] text-muted">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
