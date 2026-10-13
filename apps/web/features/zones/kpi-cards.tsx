'use client';

import { CheckCircle2, Clock3, MapPinned, XCircle } from 'lucide-react';
import { StatCard } from '../../components/shared/stat-card';

interface Counts {
  total: number;
  active: number;
  inactive: number;
  upcoming: number;
}

/** KPI cards (doc 20 Zone Management; trend chips need history — later task). */
export function KpiCards({ counts }: { counts: Counts | undefined }) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total Zones"
        value={counts?.total ?? '—'}
        icon={<MapPinned className="size-5" />}
        tone="info"
      />
      <StatCard
        label="Active Zones"
        value={counts?.active ?? '—'}
        icon={<CheckCircle2 className="size-5" />}
        tone="success"
      />
      <StatCard
        label="Inactive Zones"
        value={counts?.inactive ?? '—'}
        icon={<XCircle className="size-5" />}
        tone="danger"
      />
      <StatCard
        label="Upcoming Zones"
        value={counts?.upcoming ?? '—'}
        icon={<Clock3 className="size-5" />}
        tone="warning"
      />
    </div>
  );
}
