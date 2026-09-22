/**
 * Health status primitives (11 s4).
 * NOT_CONFIGURED is rendered as a distinct neutral state - never green,
 * never a silent pass (14 s4: honesty about backup/infra status).
 */
import type { HealthReport } from '../../../shared/types';
import { Card } from '../../components/ui/primitives';

type Status = HealthReport['r2'];

const TONE: Record<Status, { color: string; bg: string; label: string }> = {
  HEALTHY: { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Healthy' },
  DEGRADED: { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Degraded' },
  DOWN: { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Down' },
  NOT_CONFIGURED: { color: 'var(--text-3)', bg: 'var(--surface-2)', label: 'Not configured' },
};

export function HealthCard({
  title,
  status,
  detail,
}: {
  title: string;
  status: Status;
  detail?: string;
}) {
  const tone = TONE[status];
  return (
    <Card className="relative overflow-hidden">
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: tone.color }} />
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
        {title}
      </p>
      <div className="flex items-center gap-2 mt-2.5">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-medium"
          style={{ background: tone.bg, color: tone.color }}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} />
          {tone.label}
        </span>
      </div>
      {detail && <p className="text-[11.5px] text-[var(--text-3)] mt-2">{detail}</p>}
    </Card>
  );
}

export function CapacityCard({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const nearLimit = used >= max;
  return (
    <Card>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
        Users
      </p>
      <p className="num text-[24px] font-semibold text-[var(--text-1)] mt-2 leading-none">
        {used}
        <span className="text-[15px] font-medium text-[var(--text-3)]"> / {max}</span>
      </p>
      <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-standard"
          style={{
            width: `${pct}%`,
            background: nearLimit ? 'var(--warning)' : 'var(--accent)',
          }}
        />
      </div>
      <p className="text-[11.5px] text-[var(--text-3)] mt-2">
        {nearLimit ? 'At capacity — signup is closed' : `${max - used} slot${max - used === 1 ? '' : 's'} remaining`}
      </p>
    </Card>
  );
}
