# HY3N Driver Android navigation banner

Prepared by Manus AI on 23 November 2026. Source-only follow-up to commit `16ebcf8c2ad2db3ed1cca041f6b3ea40b830eb6b`; no build or deployment is authorized or started.

## Why the banner looked different

Driver uses HY3N's own turn card over its branded map, rather than Google's standard native navigation header. The card consumes Google's real turn-by-turn instructions. Google supports custom cards containing maneuver icons, road names and distances, but a custom renderer does not automatically reproduce the Google Maps app or Uber's design. [1]

The Android refinement keeps this architecture. It does not replace the map, change navigation destinations or introduce another provider.

## Android changes

The turn arrow now occupies its own compact column. The next-turn distance appears prominently above the instruction, at 24-dp text size, instead of below the arrow. The instruction, road name and target retain their real provider/server text. Panel spacing and summary padding are tighter; the instruction panel minimum is 76 dp instead of 100 dp, with no fixed height. Longer text and larger accessibility fonts can wrap and grow, so the minimum is not a promise that every rendered banner is shorter.

Sharp turns now use sharp-turn icons rather than ordinary left/right icons. Known ramp variants retain their actual normal, slight, sharp, keep or U-turn shape. Forks, straight travel, destination, clockwise/counterclockwise U-turns and roundabout circulation use their actual native maneuver identity. A generic merge symbol is retained for merge maneuvers; no unavailable lane or roundabout-exit diagram is invented.

Missing, unknown, rerouting or message/error guidance uses a non-directional information icon, not an arrow that might be mistaken for a driving instruction. Neither English text nor road bearings are used to guess a turn. Native maneuver names outside the verified forms remain neutral. A real zero turn distance stays `0 m`; missing distance is not converted to zero. ETA, remaining trip distance, local arrival time, Pickup/Drop-off/Next stop labels and light/dark appearance remain intact.

This is a familiar Google-style custom card, not an exact Uber replica or Google's generated native maneuver-image UI. Only existing Material icons are used. No dependencies, native plugins, lane data, exit numbers or next-step fields were added. [1]

## iPhone and previous fixes preserved

The iOS banner goes through the original renderer, original styles and original maneuver helper. Runtime checks compare its normalized host tree directly with the preceding commit for representative navigation states, all target kinds and both themes. The actual banner retains its measurement callback and `pointerEvents="none"`; the map still measures its real overlay height.

Only `components/DriverNavigationBanner.tsx`, new `tests/driver-navigation-banner-runtime.test.ts` and this document differ from the preceding commit. Home, native map component, shared guidance normalization, request audio and the earlier route/audio/lower-controls fixes are unchanged. Rider, versions, app configuration, EAS profiles, dependencies, native plugins, backend, fares, payments, credentials and environment variables are untouched.

## Verification

The exact prior banner was bundled through the same new runtime harness: two tests passed and four Android refinement tests failed as expected. The live source then passed the new banner cases and existing navigation checks.

- Full Driver suite: **362 passed**, zero failed, skipped or cancelled.
- Focused banner/guidance/Android/iOS route suite: **95 passed**.
- TypeScript: `tsc --noEmit` passed.
- Scoped banner/test ESLint: passed with no lint errors or lint warnings; Node still emits the existing module-type configuration warning.
- Banner-only changed-file scope and diff whitespace check: passed.

Tests bundle and execute the actual component with mocked native hosts. They verify styles, text, icons, platform routing and measurement/pointer contracts, not physical Android drawing, Yoga font layout or driving performance. Device checking is still needed for real maneuver appearance, long road names, large fonts, the visible map area and unchanged iPhone behavior.

No Driver build, prebuild, AAB, upload, store submission, deployment or OTA was started. This source change is not yet installed on the user's phone.

## References

[1]: https://developers.google.com/maps/documentation/navigation/android-sdk/tbt-feed "Google turn-by-turn data feed and custom maneuver cards"
