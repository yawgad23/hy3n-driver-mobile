import assert from 'node:assert/strict';
import test from 'node:test';
import { driverHistoryWeekBounds, isDriverHistoryThisWeek } from '../lib/driver-history-periods';

test('This Week includes a completed Sunday trip in the calendar week that began on Monday', () => {
  const sundayMorning = new Date(2026, 9, 18, 10, 49, 0, 0);
  assert.equal(sundayMorning.getDay(), 0, 'fixture must be a Sunday');

  const { weekStart } = driverHistoryWeekBounds(sundayMorning);
  assert.equal(weekStart.toDateString(), new Date(2026, 9, 12).toDateString());
  assert.equal(isDriverHistoryThisWeek(new Date(2026, 9, 18, 9, 30, 0, 0), sundayMorning), true);
  assert.equal(isDriverHistoryThisWeek(new Date(2026, 9, 19, 9, 30, 0, 0), sundayMorning), false);
  assert.equal(isDriverHistoryThisWeek(new Date(2026, 9, 11, 23, 59, 59, 999), sundayMorning), false);
});

test('This Week starts a new Monday–Sunday period without retaining the prior Sunday', () => {
  const mondayMorning = new Date(2026, 9, 19, 8, 0, 0, 0);
  assert.equal(mondayMorning.getDay(), 1, 'fixture must be a Monday');

  const { weekStart } = driverHistoryWeekBounds(mondayMorning);
  assert.equal(weekStart.toDateString(), mondayMorning.toDateString());
  assert.equal(isDriverHistoryThisWeek(new Date(2026, 9, 19, 0, 0, 0, 0), mondayMorning), true);
  assert.equal(isDriverHistoryThisWeek(new Date(2026, 9, 18, 23, 59, 59, 999), mondayMorning), false);
});
