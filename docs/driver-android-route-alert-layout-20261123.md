# HY3N Driver Android: route, request song and bottom controls

Prepared by Manus AI on 23 November 2026. This is a source-only correction, not a new installed app or store release.

Repository: `yawgad23/hy3n-driver-mobile`.
Branch: `task/driver-android-route-alert-layout-20261123`.
Preserved release baseline: `a7209d6a32f6e1df10a6760a66141e0242a56cf6`.

The newer Driver release baseline was used rather than the older main branch so the existing Android verification-keyboard and rating-button fixes remain intact. Source version remains **1.0.2**, Android version code **57022**, and iOS build number **124**. These are repository configuration values, not a claim about the user's installed version or current store review status.

## 1. Route lines

The pinned Google Navigation React Native SDK 0.16.3 supplies its JavaScript map-controller handle before Android has necessarily finished native map initialization. The old Driver component drew route overlays using that handle without waiting for the separate map-ready callback. Real component regressions reproduced premature native polyline operations and delayed drawing in both callback orders. Android now waits for both readiness and the controller. It also resets that state when missing location temporarily removes the map, then recovers the accepted route on the replacement map without requesting another destination. [1]

A second route-selection defect rejected genuine native road routes when the road endpoint was more than 150 metres from an off-road pickup. Google's native contract distinguishes the routable road endpoint from the destination waypoint. Android now checks the native destination waypoint against the server target and, when supplied, verifies that the geometry reaches the declared native road endpoint. Conflicting or malformed metadata is rejected; older snapshots without waypoint metadata keep the previous endpoint check. No artificial straight connector is drawn. The corresponding regression uses a real-format native route ending approximately 220 metres from its matching pickup waypoint. [2]

Changes are in `components/NativeDriverGoogleMap.tsx` and new `lib/driver-android-route-target.ts`. Existing ordered bridge writes and stale-request, target, controller and readiness guards remain active. Live GPS vehicle motion, real traffic geometry, approved stops and server-owned trip state remain authoritative. The iOS route-selection and controller-created behavior remain unchanged.

## 2. Song after Accept

Executing the actual Home acceptance handler and playback effect reproduced a fresh offer B starting the song while acceptance of offer A was still awaiting the server. The existing suppression reference covered only A, and the active trip had not yet been confirmed. Android now keeps all incoming-request playback silent while acceptance is pending. Genuine failed acceptance can re-arm the same still-eligible offer; successful or reconciled server assignment remains silent.

The pinned expo-audio 1.1.1 Android implementation also retains a native resume flag after suspension when its ordinary pause method is called. Existing mute normally makes that later resume silent, so this native flag alone was **not** reported as a reproduced audible failure. The Android fix instead owns a fresh player per eligible offer and independently pauses, silences, unregisters and releases it on stop. This removes the accepted source from native resume ownership, including failure-isolation cases. It also waits for actual native load and seek readiness and cancels that wait on stop. [3]

Changes are in `lib/driver-request-audio.ts` and the minimal audio integration in `app/(tabs)/home.tsx`. iOS keeps its original hook-owned WAV player and playback policy. The Android placeholder hook has no request WAV source; the real per-offer player is created only during eligible playback, not during React rendering. No global audio shutdown, notification changes, polling timers or background-media feature was added. Accept, swipe, auto-accept and reconciliation still use the existing server-authoritative handlers.

## 3. Controls lower on the map

The panel was already anchored at the bottom, but Home repeated system-bottom clearance in both the outer panel and active actions even though the non-absolute tab bar already reserves that space. The availability card below the actions added more height. Long offer, queue or route-change panels could push the controls further upward.

Android now uses an 8-dp panel-bottom gap without repeating the system/tab inset. The availability card is compact while preserving wrapping text and a growable touch target of at least 44 dp. Home measures its actual tab-contained height and the natural dock content height. Android-only scrolling regions bound auxiliary panels and the dock when space or accessibility font size requires it. The map continues receiving the **actual rendered panel height**, plus its existing 12-dp breathing room; no invented camera inset or screen-height percentage is used.

Changes are in Home layout and new `lib/driver-android-home-layout.tsx`. Navigate, Chat, Call, Cancel and Arrived labels, enabled states and handlers are preserved. Existing action style declarations remain unchanged. On iOS the new region helper renders only transparent fragments, and the normalized native host-tree matrix matches the exact release baseline in all tested states and themes.

## Validation completed

Validation was run against the integrated repository Home, not the audio investigator's proposed copy.

- **Full Driver regression suite: 356 passed, zero failed, skipped or cancelled.**
- **Focused integrated route/audio/layout/iOS-preservation suite: 143 passed.**
- **TypeScript: passed**, `tsc --noEmit` exit 0.
- Scoped ESLint: exit 0, **zero errors and 23 warnings**. Warnings include existing Home warnings and hook/style warnings; this is not a warning-free lint result.
- Changed-file scope and `git diff --check`: passed.

The unmodified release baseline had 314 of 315 tests passing. Its sole failure was a stale source regex expecting a fixed 48-by-48 Navigate icon style. The actual preserved baseline style is 46 dp high and 48 dp wide. The assertion was replaced with executable AST-evaluated comparison to the exact baseline, preserving the functional navigation-app choice assertions and minimum touch-target check. The final suite is therefore fully green without changing those preserved dimensions.

New tests execute actual Home expressions and render trees, the actual map component with mocked native boundaries, native route metadata validation and a source-backed expo-audio Android lifecycle model. Red-first regressions demonstrated the defects before their respective production edits. Layout scope checks allow only the exact separately verified Android audio expressions; every original server/offer handler, existing style and trailing keyboard/rating modal remains preserved.

Regression files are `tests/driver-android-home-layout.test.ts`, `tests/driver-android-route-target.test.ts`, `tests/driver-request-audio-android-lifecycle.test.ts`, `tests/driver-request-audio-home-lifecycle.test.ts`, `tests/driver-route-runtime.test.ts`, `tests/driver-ios-reroute-runtime.test.ts` and `tests/native-google-map.test.ts`. The existing iOS runtime test mock now emits map readiness only on its Android branch; iOS mock behavior is unchanged.

## Preserved scope and release status

No Rider repository, backend, fare, payment, cancellation or settlement implementation was changed. Driver app configuration, EAS profiles, versions, dependency manifests and lockfile, tab-bar configuration, native plugins, vehicle assets, notification handlers, credentials and environment variables are unchanged. Existing Android verification-keyboard and rating-safe-area fixes are preserved.

**No Driver native build, prebuild, AAB, upload, submission, deployment or OTA was started.** The changes are on a new task branch; main and the previous release branch were not merged, rewritten or force-pushed.

Source regressions do not establish the exact sequence that caused the user's installed Android symptoms. No physical Android or iPhone test, native compilation, installed-version check, API-key/billing investigation or production runtime-log capture was performed. No supplied restricted screenshot was reopened, copied or shared.

After a separately approved Android build, device verification should cover visible pickup/dropoff/approved-stop road lines and traffic, controller/readiness startup, missing-location recovery, background/resume and focus interruptions, manual/swipe/auto acceptance, failed and reconciled acceptance, and a subsequent fresh offer. Check the controls on gesture and three-button navigation, small and large screens, long addresses and larger fonts. Confirm that confirmed local arrival clears only the display route and that the server remains responsible for the ride transition. Verify iPhone layout and sound remain unchanged.

## References

[1]: https://developers.google.com/android/reference/com/google/android/gms/maps/OnMapReadyCallback "Android native map-ready contract"
[2]: https://developers.google.com/maps/documentation/navigation/android-sdk/reference/com/google/android/libraries/navigation/RouteSegment "Native road endpoint and destination waypoint contract"
[3]: https://unpkg.com/expo-audio@1.1.1/android/src/main/java/expo/modules/audio/AudioModule.kt "Pinned expo-audio Android source inspected in the installed dependency"
