# HY3N Driver live navigation improvements

Implemented on 22 November 2026 for `yawgad23/hy3n-driver-mobile`, starting from `b1d4fbd`. The code changes cover Android and iOS. No app build, Expo prebuild, store submission, deployment, API-key change, or billing change was performed.

## Navigation behavior

The top map banner now subscribes to the existing Google Navigation SDK's live turn-by-turn feed. It displays the provider's maneuver instruction, a large directional icon, live distance before the maneuver, and the SDK-supplied road name. Verified Android and iOS maneuver enums provide icon direction and a fallback label when the SDK supplies a maneuver but omits its instruction text. Unknown guidance is shown as unavailable rather than as a made-up turn. `fullRoadName` belongs to the maneuver supplied by Google; it is not independently asserted to be the current road underneath the car.

The summary strip shows native remaining distance, estimated travel time, and arrival time in the phone's locale and time zone. It uses the current waypoint's totals rather than accidentally showing a later final leg. Geometry-derived remaining distance is available as a fallback, but ETA is never estimated from vehicle speed. Missing metrics, including zero fields omitted by the iOS serializer, remain unknown unless Google explicitly supplies a value.

The map follows the accepted vehicle position with a heading-up, forward-looking camera at a stable zoom and tilt. Updates are throttled and coalesced, and small stationary compass changes do not rotate the camera. The existing realistic car and motorcycle assets, marker interpolation, location publishing, trip meter, fare calculations, and native voice routing are retained. Both native bridges can update custom polyline IDs in place, so healthy progress no longer removes and recreates the blue route on every GPS sample.

Drivers can pause following using **Explore map** and resume using **Recenter**. Wrapper swipe/pinch detection and map clicks also pause following. Native gesture-reason callbacks are not exposed by this bare MapView, so touch detection is best-effort; the explicit control remains available. Traffic refreshes and reroutes do not automatically override manual exploration. A new trip target restores navigation following.

Home measures the existing header and bottom controls and reserves native map space around them and the navigation banner. Android padding is converted to physical pixels; iOS uses layout points. The usable viewport is bounded rather than allowing excessive padding to collapse the native map. The basemap continues to follow the device's light/dark setting, and the banner and summary respect the same setting.

## Traffic shown honestly

Android now displays Google's actual orange slowdown and red congestion intervals above the blue route. The app accepts the string enum values produced by the installed bridge, uses the exact selected current-or-complete geometry snapshot, and trims already-passed congestion. Missing traffic data clears old custom congestion overlays; it is not labeled as free-flow traffic. A reproducible Android native layering patch makes the blue base, outline, and congestion overlays render in the intended order.

**iOS retains Google's real native road-traffic layer, but the installed SDK's iOS bridge does not expose route-stretch congestion data.** Its custom active route therefore remains blue; this change does not provide identical orange/red active-route highlighting on iOS. No congestion is fabricated from speed, ETA, or delay severity. Full active-route color parity on iOS remains a separate integration requirement.

The supplied `IMG_2786.MOV` was reviewed as the layout reference. It shows a prominent dark maneuver banner, a lower-center driver marker, and orange/red congestion. Its blurred text and short duration do not establish exact road names, ETA values, or lifecycle behavior.

## Target changes and stale events

The existing server-verified target selector still controls pickup, destination, and approved stops. Navigation identity now includes the ride ID and approved stop ID, so a new trip or stop at the same coordinates is not mistaken for the previous one. Pickup-arrived state pauses guidance while the driver waits for the rider; starting the trip replaces it with destination guidance. Clearing a trip removes the turn banner, route, congestion overlays, and ETA. A Google arrival remains a locally validated display prompt; it never completes a HY3N trip or changes a fare.

Native turn and metric events carry the actual native destination coordinates, native destination-mutation generation, and native capture time. JavaScript requires a separately validated current-route envelope even when complete-route geometry is used as a fallback. Events with missing context, the wrong target or generation, or expired capture time are rejected. Guidance is cleared on replacement, rerouting, arrival, stop, failure, or lost context. Displayed turn and ETA data expire after 15 seconds without a fresh source update. Deferred ETA reads and queued route/camera work are fenced against changed targets.

The version-pinned native feed patch suppresses events during destination replacement, prevents old mutation completions from reactivating context, and carries Android NavInfo receipt context through LiveData instead of relabeling cached replay. Source hashes and exact reversible anchors make unsupported SDK drift fail loudly during prebuild. Existing SDK payload and codegen fields are preserved apart from the optional envelope.

These safeguards address native lifecycle and bridge replay, not an unavailable SDK-internal route identifier. The installed SDK exposes no raw NavInfo route ID or original internal capture timestamp. An old internal SDK message first received after a new activation cannot be conclusively distinguished by the envelope alone. Native compilation and repeated rapid-transition tests on real phones remain required; automated mocks are not a proof of internal SDK provenance.

## Files changed

UI integration:
- `components/NativeDriverGoogleMap.tsx`: live feed subscriptions, ETA polling, bounded freshness, lifecycle clearing, camera following, gesture/recenter controls, blue remaining route, real Android traffic, map padding, and queued-work guards.
- `components/DriverNavigationBanner.tsx`: maneuver banner, road name, turn distance, native ETA/distance/arrival strip, and themed readable layout.
- `app/(tabs)/home.tsx`: ride/stop identity, pickup-waiting pause, theme and measured overlay insets. The existing target memo was moved before the approval early return to fix its conditional hook-order defect.

Data and display helpers:
- `lib/driver-navigation-guidance.ts`: defensive parsing of the actual native payload, verified maneuver mappings, and distance/time/arrival formatting.
- `lib/driver-navigation-feed.ts`: native envelope target/generation/freshness acceptance and metric validation.
- `lib/driver-navigation-camera.ts`: forward camera sampling, movement/heading jitter suppression, throttling, and density-aware bounded padding.
- `lib/driver-route-traffic.ts`: provider traffic intervals, boundary interpolation, and progress trimming against the exact route snapshot.

Reproducible native integration:
- `plugins/driver-navigation-feed-patch.js`: Android/iOS feed lifecycle and receipt safeguards, optional codegen context fields, strict source validation, and prebuild-only application.
- `plugins/driver-navigation-polyline-patch.js`: Android create/update polyline z-index handling already supported by native codegen and iOS.
- `plugins/with-google-navigation.js`: wires the two patches into the existing plugin without replacing marker, key, or platform configuration logic.

Tests:
- Updated `tests/driver-route-runtime.test.ts` and `tests/driver-ios-reroute-runtime.test.ts` execute the actual component with mocked native boundaries on both platform branches.
- Added `tests/driver-navigation-guidance.test.ts`, `tests/driver-route-traffic.test.ts`, `tests/driver-navigation-camera.test.ts`, `tests/driver-navigation-feed.test.ts`, `tests/driver-navigation-feed-patch.test.ts`, and `tests/driver-navigation-polyline-patch.test.ts`.
- This handover is `docs/driver-navigation-improvements.md`.

## Validation results

Before changes, TypeScript passed and all **191 baseline tests passed**. After the changes, `pnpm check` passed and **315/315 tests passed**, with no failures, skipped tests, or cancelled tests. Coverage includes both platform branches, pickup/destination and same-coordinate ride transitions, stale guidance and late ETA rejection, local arrival and waiting state, rerouting and passed-road removal, following/pause/recenter, gesture pause surviving traffic refresh, padding, provider congestion trimming, no-data clearing, and native source patch integrity/idempotence.

Scoped ESLint for the changed navigation component/banner/helpers passed with no lint findings. Repository-wide `pnpm lint` still reports **3 pre-existing text-escaping errors and 36 warnings** outside these navigation files. The baseline had 4 errors and 38 warnings; the Home hook-order defect and navigation callback warnings were corrected. The remaining lint errors are in `app/index.tsx` and `app/(tabs)/_layout.tsx` and were not changed as part of this map task.

`git diff --check` and native patch JavaScript syntax checks passed. Patch tests use in-memory strings and temporary fixtures. Shared installed SDK sources were not mutated. No native compilation, simulator navigation run, physical Android/iPhone test, real traffic observation, or road test was performed in this Linux sandbox.

## Google configuration and costs

The existing Google React Native Navigation SDK **0.16.3**, Android Navigation **7.6.1**, and iOS GoogleNavigation **10.13.0** are reused. No new Directions or Routes REST service is needed for the banner. Google supports custom navigation interfaces using its navigation feed.[1] [2]

Existing keys must have the correct Navigation SDK/API enablement and billing. Android package/signing-certificate restrictions and iOS bundle restrictions must match the approved binaries. No API credentials or Cloud configuration were changed in this task.[3]

The banner, local camera, native metric reads, and traffic-overlay refresh do not introduce extra explicit destination requests. Google bills navigation destination requests; starting guidance and SDK automatic route changes for traffic or deviations do not add destination-request fees. The existing explicit GPS fallback `setDestination` calls must not be assumed to be free.[4]

Google's published global Navigation Request pricing currently includes 1,000 free destinations per month and a first paid tier of **US$25 per 1,000 destinations**, with volume discounts. Actual billing depends on account terms, region, usage, and other enabled map services. This task did not change billing.[5]

## Before approving a release

A **new native build is required** to include both source patches. Do not distribute this as a JavaScript-only OTA to an older binary: absent context intentionally leaves real turn/ETA display unavailable instead of trusting retagged stale events. App versions and build numbers have not been changed.

After explicit build approval, native compilation and physical testing must cover:

1. Accept a pickup trip on Android and iPhone. Compare banner icon, exact instruction, road name, live maneuver distance, ETA, and voice prompts with Google's actual navigation.
2. Arrive at pickup, wait, and start the trip. Verify immediate old-turn clearing and correct destination guidance. Repeat rapid changes and a new trip at the same coordinates.
3. Add and complete an approved stop. Confirm the exact server-approved stop is used and no pending request or old stop changes guidance.
4. Drive a safe missed-turn/wrong-way test with accurate GPS. Verify route replacement, fresh instructions, remaining-road trimming, and unchanged HY3N trip/fare behavior.
5. Swipe, pinch, explore, and recenter. Confirm no background route/traffic event snaps the map back unexpectedly. Check small phones, larger text, landscape, notches, and both themes so the vehicle and attribution remain visible.
6. Observe genuine Android congestion and verify red/orange sections disappear after passing them or when provider data is unavailable. Verify iOS's real road traffic remains visible without claiming custom route-color parity.
7. Background/foreground and briefly lose GPS/network. Confirm recovery does not replay a prior trip, and completion/cancellation/idle clears navigation, timers, overlays, and screen-awake behavior.

No build or store submission should proceed before approval, and no release should be described as device-verified until these checks have actually passed.

## References

[1]: https://developers.google.com/maps/documentation/navigation/android-sdk/intro-custom-nav "Google Navigation SDK custom navigation UI"
[2]: https://github.com/googlemaps/react-native-navigation-sdk "Google React Native Navigation SDK"
[3]: https://developers.google.com/maps/documentation/navigation/android-sdk/get-api-key "Google Navigation SDK API key configuration"
[4]: https://developers.google.com/maps/documentation/navigation/android-sdk/pricing "Google Navigation SDK billing and automatic reroutes"
[5]: https://developers.google.com/maps/billing-and-pricing/pricing "Google Maps Platform published global pricing"
