# Driver iPhone navigation: gliding and reroute recovery

## Source and scope

This patch starts from the source used for uploaded Driver iOS build 127, commit `d0048a7e115ada40bab07aec58e2ef44b20e3083`, rather than the older `main` branch. Fix branch: `task/driver-ios-navigation-glide-reroute-20261125`.

It changes Driver navigation presentation/recovery only. Rider source, Android's default motion/camera behavior, server destination authority, authenticated location publishing, fare/meter state, SDK 27 compatibility, app versions/build numbers, native plugins, dependencies and environment variables remain unchanged. No new native build, prebuild, upload or deployment is part of this patch.

## Corrected behavior

- Independent raw-GPS deviation evidence cannot be reset or hidden by newer native old-road snaps. Freshness, accuracy, distinct-sample confirmation and a shared reroute cooldown remain enforced.
- Display source preference is bounded while providers agree. Confirmed raw deviation can take over both route and car even when the raw timestamp trails a native snap. Same-source duplicate/out-of-order observations cannot restart movement; backward cross-source handoff resets cadence safely.
- Replacement routes must connect to fresh current GPS as well as match the active server target. Current/complete candidate selection prefers connected geometry; invalid replacements do not overwrite accepted route state.
- Successful same-road reroutes are checked against GPS at acceptance, with bounded continuity from the request origin, so movement during native requests does not hide a valid replacement. Old-target/controller/request and stale shared-road safeguards remain.
- Both iPhone location providers use the same timestamp-aware animator. Native callbacks no longer cancel gliding and write every endpoint directly.
- Unavailable/null/negative course cannot become north. Moving car orientation follows the rendered travel segment; parked jitter preserves reliable orientation.
- Verified, tightly connected and forward-progressing road bends are traversed explicitly. Disconnected, sparse, reversed, looping or excessive-detour geometry falls back to direct movement between genuine observations. No route is fabricated, and old geometry is not forced during rerouting.
- The iPhone camera classifies movement from accepted GPS intervals rather than tiny animation steps. Parked recenter preserves its reliable bearing. Latest vehicle artwork is retained during an active movement; unmount invalidates pending frames.
- Reroute requests explicitly restart Google's independent origin provider. `LOCATION_UNKNOWN` reports waiting for native location rather than incorrectly asserting that precise location is disabled; new fresh observations can recover after cooldown.

## Local checks

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsx --test --test-concurrency=4 tests/*.test.ts
./node_modules/.bin/eslint components/NativeDriverGoogleMap.tsx lib/driver-map-motion.ts lib/driver-navigation-camera.ts tests/driver-ios-reroute-runtime.test.ts tests/driver-ios-release-metadata.test.ts tests/driver-map-motion.test.ts tests/driver-navigation-camera.test.ts
git diff --check
```

The real React component tests use mocked native bridges and synthetic coordinates. Added assertions require the corrected behavior for raw/native disagreement, delayed moving-origin success, disconnected and partial geometry, millisecond jitter and multi-second handoffs, steady native cadence, missing/contradictory course, duplicates/metadata renders, verified bends, low-speed turns, parked recenter, mid-animation asset changes, unmount and native-origin recovery. Default helper behavior and Android runtime behavior remain covered.

The historical SDK checkpoint's byte-for-byte map/camera/motion assertion is updated only for these authorized navigation changes. It still verifies unchanged map/banner/provider UI, unrelated Home/trip/publisher source, released default motion logic, SDK/native configuration and release metadata.

## Device verification gate

Passing source tests is not proof of native iPhone rendering or the exact reported drive. Do not claim physical-road verification. A new build/upload requires separate explicit approval; preserve SDK 27 and obtain the next unused iOS build number at that time.

After installing that approved candidate, verify a missed turn/different road, movement during rerouting, a normal bend, slow turns, parked/recenter behavior and foreground recovery. Confirm the car and route follow the actual current road, the car faces its rendered movement and glides between fixes, disconnected/old-target routes never reappear, and native-origin recovery does not loop destination requests. Use bounded non-location diagnostics if attribution is still needed; do not log unnecessary precise coordinates or change production environment flags during source preparation.

## Verification results — 25 November 2026

Final complete Driver suite: **654 passed, 0 failed, 0 skipped**. Final TypeScript `--noEmit`: **passed**. Whitespace/diff validation: **passed**. Rider worktree remains clean. No generated `ios/` directory was created, and no release configuration or build number was changed.

The targeted lint command is **not fully clean**: the released map source already had 20 React compiler lint errors; this patch leaves 16 in the same existing `refs`, `set-state-in-effect` and `preserve-manual-memoization` categories. New callback-ref wiring was moved to committed effects and has no new lint errors. Motion/camera helpers and their tests lint clean. The existing mocked MapView test-harness dependency warning remains. Do not represent lint as passing or broaden this navigation patch into a whole-component refactor merely to eliminate historical warnings.

An independent review identified a fresh raw-GPS handoff with more than one second of timestamp skew. That issue was corrected and covered by an actual-component regression asserting both route and car takeover; same-source out-of-order protection still passes. All test results above were rerun after that correction and the final effect cleanup.

## Uber-reference route framing — 25–26 November 2026

The user supplied `IMG_2787.MOV` as the desired camera reference. The clearest portion shows a near-flat heading-up map, the vehicle low in the unobscured map and the blue route occupying most of the space ahead. The short, blurred clip does not establish dynamic turn/speed/zoom behavior or Uber's proprietary settings. No original video, personal addresses or reference images are committed to this repository.

An additional iPhone-only `routeForwardView` now applies during active pickup, destination and approved-stop navigation, excluding explicit navigation pause. It uses a flat overhead camera (`tilt: 0`), stable close-road zoom (`17.6`) and a forward framing offset based on the actual usable viewport. This is a deliberate HY3N implementation of the observed framing principle, not a claim to reproduce Uber's exact numerical camera settings.

The realistic car sits low in the visible map so more road is shown ahead. Nominal offset is 32% of the usable height below center, bounded to retain 44 logical points above the dock when space permits. When native map padding is compressed, the framing also accounts for physical overlay overlap rather than mistaking compressed padding for the real dock boundary. If the actual clear region is too small to fit the whole car, its center stays in that region instead of assuming impossible clearance.

Initial iPhone zoom/tilt match the route-forward policy; the accepted location animator applies forward camera positioning as soon as the map controller is ready. Current reliable movement bearing remains heading-up, while parked stabilization, Explore, Recenter, source-authoritative vehicle movement and reroute protections are retained. Android/default camera and the older optional close-view helper remain unchanged when `routeForwardView` is absent.

Added policy tests cover heading directions, lower anchor, stable zoom, short viewports, physical dock overlap, parked recenter and unchanged defaults. Actual-component checks cover active pickup/Start, overlay resize, Explore/Recenter, pending destination setup and Android isolation. Native Google padding/safe-area projection still needs a screenshot/road check on the approved iPhone candidate; the source tests do not prove pixel-perfect on-device framing. No build or upload is started by this adjustment.

Reference-framing validation: **658 complete Driver tests passed, 0 failed, 0 skipped**; TypeScript `--noEmit` and diff validation passed. The prior reroute/gliding fix remains an ancestor of this camera adjustment. Rider and Android behavior remain unchanged, and no native build/upload or release metadata change was made.
