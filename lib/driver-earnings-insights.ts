export type EarningsTrendPoint = {
  date: string;
  amount: number;
};

export type EarningsComparison = {
  current?: unknown;
  previous?: unknown;
  change?: unknown;
  percentChange?: unknown;
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function safeDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function driverTrendLabel(date: string, days: number) {
  const value = safeDate(date);
  if (!value) return '—';
  if (days > 7) return value.toLocaleDateString('en-GH', { month: 'short', day: 'numeric' });
  if (days === 1) return 'Today';
  return value.toLocaleDateString('en-GH', { weekday: 'short' });
}

/** Formats only actual completed-trip data returned by the trusted backend. */
export function getDriverEarningsInsight(
  points: EarningsTrendPoint[],
  comparison: EarningsComparison | null | undefined,
  days: number,
) {
  const trend = points.map((point) => ({
    date: point.date,
    amount: money(point.amount),
  }));
  const activeDays = trend.filter((point) => point.amount > 0);
  const bestDay = activeDays.reduce<EarningsTrendPoint | null>((best, point) => (
    !best || point.amount > best.amount ? point : best
  ), null);
  const current = money(comparison?.current);
  const previous = money(comparison?.previous);
  const change = Number(comparison?.change || 0);
  const percentChange = Number(comparison?.percentChange);

  if (current <= 0) {
    return {
      activeDays: 0,
      bestDay: null,
      comparisonText: 'Complete trips to unlock your verified earnings trend.',
      comparisonTone: 'neutral' as const,
    };
  }

  if (previous <= 0) {
    return {
      activeDays: activeDays.length,
      bestDay,
      comparisonText: `GH₵${current.toFixed(0)} from completed trips in the last ${days} day${days === 1 ? '' : 's'}.`,
      comparisonTone: 'positive' as const,
    };
  }

  const direction = change >= 0 ? 'up' : 'down';
  const percent = Number.isFinite(percentChange) ? `${Math.abs(percentChange).toFixed(0)}%` : `GH₵${Math.abs(change).toFixed(0)}`;
  return {
    activeDays: activeDays.length,
    bestDay,
    comparisonText: `${percent} ${direction} from the previous ${days}-day period.`,
    comparisonTone: change >= 0 ? 'positive' as const : 'neutral' as const,
  };
}
