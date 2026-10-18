export function driverHistoryWeekBounds(referenceDate = new Date()) {
  const reference = new Date(referenceDate);
  const weekStart = new Date(reference);
  // JavaScript numbers Sunday as 0. Convert that to days since Monday so a
  // Sunday stays in the Monday–Sunday week that is ending, rather than being
  // placed in the following week.
  const daysSinceMonday = (reference.getDay() + 6) % 7;
  weekStart.setDate(reference.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

export function isDriverHistoryThisWeek(date: Date, referenceDate = new Date()) {
  if (!Number.isFinite(date.getTime())) return false;
  const { weekStart, weekEnd } = driverHistoryWeekBounds(referenceDate);
  return date >= weekStart && date <= weekEnd;
}
