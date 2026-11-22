import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDriverGuidanceEvents, formatNavigationDistance, formatNavigationDuration,
  formatNavigationArrivalTime, driverGuidanceMatchesTarget, type DriverManeuver,
} from '../lib/driver-navigation-guidance';

function event(maneuver: unknown = 6, extras: Record<string, unknown> = {}) {
  return {
    navState: 1, currentStep: { maneuver, instruction: 'Turn left onto Independence Avenue', fullRoadName: 'Independence Avenue' },
    distanceToCurrentStepMeters: 85, distanceToNextDestinationMeters: 1400,
    timeToNextDestinationSeconds: 240, ...extras,
  };
}

test('real Android/iOS runtime instruction, road and next-waypoint totals are used', () => {
  const guidance = normalizeDriverGuidanceEvents([event(6, {
    distanceToFinalDestinationMeters: 9000, timeToFinalDestinationSeconds: 1800, routeChanged: true,
  })]);
  assert.deepEqual(guidance, {
    navState: 'enroute', rawNavState: 1, maneuver: 'left', rawManeuver: 6,
    nativeManeuverName: 'TURN_LEFT', instruction: 'Turn left onto Independence Avenue', roadName: 'Independence Avenue',
    distanceToManeuverMeters: 85, remainingDistanceMeters: 1400, remainingTimeSeconds: 240,
    maneuverPosition: null, destinationPosition: null, routeChanged: true,
  });
});

test('all independently verified Google Android/iOS maneuver numeric IDs are normalized', () => {
  const common: Record<number, DriverManeuver> = {
    0: 'unknown', 1: 'unknown', 2: 'arrival', 3: 'arrival', 4: 'arrival', 5: 'straight',
    6: 'left', 7: 'right', 8: 'keep-left', 9: 'keep-right', 10: 'slight-left', 11: 'slight-right',
    12: 'left', 13: 'right', 14: 'u-turn', 15: 'u-turn', 16: 'merge', 17: 'merge', 18: 'merge',
    19: 'keep-left', 20: 'keep-right', 63: 'unknown', 64: 'unknown', 65: 'unknown',
  };
  for (let code = 0; code <= 65; code++) {
    const expected = code >= 21 && code <= 42 ? 'ramp' : code >= 43 && code <= 62 ? 'roundabout' : common[code];
    const guidance = normalizeDriverGuidanceEvents([event(code, { currentStep: { maneuver: code } })]);
    assert.equal(guidance?.maneuver, expected, `maneuver ${code}`);
    assert.deepEqual(normalizeDriverGuidanceEvents([event(code, { currentStep: { maneuver: code } })], 'ios'), guidance);
    assert.deepEqual(normalizeDriverGuidanceEvents([event(code, { currentStep: { maneuver: code } })], 'android'), guidance);
    assert.ok(guidance?.nativeManeuverName, `verified native name for ${code}`);
    if (code > 0) assert.ok(guidance?.instruction, `enum fallback for ${code}`);
    else assert.equal(guidance?.instruction, null);
    assert.equal(guidance?.roadName, null, 'no invented road name');
  }
});

test('a real instruction is not rewritten or used to guess a maneuver arrow', () => {
  const guidance = normalizeDriverGuidanceEvents([event(987)]);
  assert.equal(guidance?.instruction, 'Turn left onto Independence Avenue');
  assert.equal(guidance?.maneuver, 'unknown');
  for (const maneuver of [undefined, null, -1, NaN, Infinity, 6.5, '6', 'turn-left', 'TURN_LEFT']) {
    const result = normalizeDriverGuidanceEvents([event(maneuver, { currentStep: { maneuver } })]);
    assert.equal(result?.maneuver, 'unknown');
    assert.equal(result?.instruction, null);
  }
});

test('blank instruction falls back only to the actual enum, with safe unavailable for unknown', () => {
  assert.equal(normalizeDriverGuidanceEvents([event(0, { currentStep: { maneuver: 0, instruction: '  ' } })])?.instruction, null);
  assert.equal(normalizeDriverGuidanceEvents([event(7, { currentStep: { maneuver: 7, instruction: null } })])?.instruction, 'Turn right');
  assert.equal(normalizeDriverGuidanceEvents([event(6, { currentStep: { maneuver: 6, instruction: {}, fullRoadName: 1 } })])?.roadName, null);
  assert.equal(normalizeDriverGuidanceEvents([event(6, { currentStep: { maneuver: 6, instruction: '\u0000Take the exit\n', fullRoadName: '   N1   ' } })])?.instruction, 'Take the exit');
});

test('latest update in a callback batch or native envelope wins, never the first', () => {
  assert.equal(normalizeDriverGuidanceEvents([event(6), event(7)])?.maneuver, 'right');
  assert.equal(normalizeDriverGuidanceEvents({ turnByTurnEvents: [event(6), event(7)] })?.maneuver, 'right');
  assert.equal(normalizeDriverGuidanceEvents([event(6), null]), null);
  assert.equal(normalizeDriverGuidanceEvents([event(6), {}]), null);
  assert.equal(normalizeDriverGuidanceEvents(event(7))?.maneuver, 'right');
});

test('rerouting, stopped and unknown states clear stale turn and route totals without inventing arrival', () => {
  for (const [raw, state] of [[0, 'unknown'], [2, 'rerouting'], [3, 'stopped'], [999, 'unknown']] as const) {
    const result = normalizeDriverGuidanceEvents([event(2, { navState: raw })]);
    assert.equal(result?.navState, state);
    assert.equal(result?.maneuver, 'unknown');
    assert.equal(result?.instruction, null);
    assert.equal(result?.remainingTimeSeconds, null);
    assert.equal(result?.remainingDistanceMeters, null);
    assert.equal(result?.distanceToManeuverMeters, null);
  }
  assert.equal(normalizeDriverGuidanceEvents([event(2)])?.navState, 'enroute', 'upcoming arrival is not arrival confirmation');
});

test('null, malformed and negative native navigation data is not coerced into real information', () => {
  for (const malformed of [null, undefined, [], {}, true, 1, 'text', { turnByTurnEvents: [] }, { turnByTurnEvents: null }]) {
    assert.equal(normalizeDriverGuidanceEvents(malformed), null);
  }
  for (const bad of [null, undefined, -1, Infinity, NaN, 1.5, '1', true]) {
    assert.equal(normalizeDriverGuidanceEvents([event(6, { navState: bad })]), null);
  }
  for (const bad of [null, undefined, -1, Infinity, NaN, '80', true, Number.MAX_VALUE]) {
    const result = normalizeDriverGuidanceEvents([event(6, {
      distanceToCurrentStepMeters: bad, distanceToNextDestinationMeters: bad,
      timeToNextDestinationSeconds: bad, distanceToFinalDestinationMeters: 100,
    })]);
    assert.equal(result?.distanceToManeuverMeters, null);
    assert.equal(result?.remainingDistanceMeters, null, 'invalid present next total must not switch to a later leg');
    assert.equal(result?.remainingTimeSeconds, null);
  }
});

test('explicit zero is kept, absent iOS zero values remain unknown; step length is not turn distance', () => {
  const zero = normalizeDriverGuidanceEvents([event(6, {
    distanceToCurrentStepMeters: 0, distanceToNextDestinationMeters: 0, timeToNextDestinationSeconds: 0,
  })]);
  assert.equal(zero?.distanceToManeuverMeters, 0);
  assert.equal(zero?.remainingDistanceMeters, 0);
  assert.equal(zero?.remainingTimeSeconds, 0);
  const missing = normalizeDriverGuidanceEvents([{ navState: 1, currentStep: { maneuver: 6, distanceFromPrevStepMeters: 900, timeFromPrevStepSeconds: 100 } }]);
  assert.equal(missing?.distanceToManeuverMeters, null);
  assert.equal(missing?.remainingDistanceMeters, null);
  assert.equal(missing?.remainingTimeSeconds, null);
  assert.equal(normalizeDriverGuidanceEvents([{ navState: 1, distanceToFinalDestinationMeters: 40, timeToFinalDestinationSeconds: 60 }])?.remainingDistanceMeters, 40);
});

test('real native 0.16.3 steps cannot magically produce destination coordinates or confirm target freshness', () => {
  const result = normalizeDriverGuidanceEvents([event(6, { getRemainingSteps: [{ maneuver: 2, instruction: 'Arrive at destination' }] })]);
  assert.equal(result?.maneuverPosition, null);
  assert.equal(result?.destinationPosition, null);
  assert.equal(driverGuidanceMatchesTarget(result, { lat: 5.7, lng: -0.1 }), null);
  assert.equal(driverGuidanceMatchesTarget(result, { lat: null, lng: null }), false);
});

test('optional actual final-arrival position can reject stale target; arbitrary step position cannot', () => {
  const stale = normalizeDriverGuidanceEvents([event(6, { getRemainingSteps: [{ maneuver: 2, position: { lat: 5.7, lng: -0.1 } }] })]);
  assert.equal(driverGuidanceMatchesTarget(stale, { latitude: 5.7, longitude: -0.1 }), true);
  assert.equal(driverGuidanceMatchesTarget(stale, { lat: 5.9, lng: -0.1 }), false);
  assert.equal(driverGuidanceMatchesTarget(stale, { lat: 5.7, lng: -0.1 }, -1), false);
  const nonarrival = normalizeDriverGuidanceEvents([event(6, { getRemainingSteps: [{ maneuver: 5, position: { lat: 5.7, lng: -0.1 } }] })]);
  assert.equal(nonarrival?.destinationPosition, null);
  for (const bad of [{ lat: null, lng: null }, { lat: 0, lng: 0 }, { lat: 91, lng: 0 }, { lat: '5.7', lng: -0.1 }]) {
    assert.equal(normalizeDriverGuidanceEvents([event(6, { getRemainingSteps: [{ maneuver: 2, position: bad }] })])?.destinationPosition, null);
  }
});

test('navigation distance and duration formatting cover boundaries and reject malformed numbers', () => {
  for (const bad of [null, NaN, Infinity, -1, Number.MAX_VALUE]) {
    assert.equal(formatNavigationDistance(bad), null);
    assert.equal(formatNavigationDuration(bad), null);
  }
  assert.equal(formatNavigationDistance(0), '0 m');
  assert.equal(formatNavigationDistance(85.2), '85 m');
  assert.equal(formatNavigationDistance(999), '999 m');
  assert.equal(formatNavigationDistance(1000), '1 km');
  assert.equal(formatNavigationDistance(1550), '1.6 km');
  assert.equal(formatNavigationDuration(0), '0 min');
  assert.equal(formatNavigationDuration(1), '1 min');
  assert.equal(formatNavigationDuration(60), '1 min');
  assert.equal(formatNavigationDuration(61), '2 min');
  assert.equal(formatNavigationDuration(3600), '1 hr');
  assert.equal(formatNavigationDuration(3660), '1 hr 1 min');
});

test('arrival time follows ordinary Intl locale/timezone including rollover and DST', () => {
  const now = new Date('2026-01-02T23:50:00Z');
  const expected = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date('2026-01-03T00:10:00Z'));
  assert.equal(formatNavigationArrivalTime(1200, now, 'en-GB', { timeZone: 'UTC' }), expected);
  const dst = new Date('2026-03-08T06:50:00Z');
  assert.equal(formatNavigationArrivalTime(1200, dst, 'en-US', { timeZone: 'America/New_York' }), '3:10 AM');
  assert.equal(formatNavigationArrivalTime(0, now), new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now));
  assert.equal(formatNavigationArrivalTime(null, now), null);
  assert.equal(formatNavigationArrivalTime(-1, now), null);
  assert.equal(formatNavigationArrivalTime(1, new Date(NaN)), null);
  assert.equal(formatNavigationArrivalTime(Number.MAX_VALUE, now), null);
  assert.equal(formatNavigationArrivalTime(1, now, 'en-US', { timeZone: 'invalid-zone' }), null);
});
