# HY3N Driver Android 1.0.6 (57026) — request-sound release preparation

## Approved release

The user approved the exact two-store plan on 26 November 2026 at 16:05:43 UTC with “It is fine just continue”. Android is authorized for exactly one production cloud build, Google Play Production review, a 100% rollout across the existing 178 countries/regions, and Managed Publishing ON. These are release instructions, not claims of completed cloud compilation, review or publication. The separate iPhone release reuses existing 1.3 (132); no iPhone build or upload is included here.

## Source and metadata

Branch: `prep/driver-android-1.0.6-57026-20261126`.

The source baseline is reviewed Android request-sound fix `30f4f1227e2ce56e522722e58c07279bc64308bd`, based on delivered 57025 source `f50da8cc6bc405afcde69e0548b197ab8d948d81`.

Only the Android-selected marketing version changes from 1.0.5 to 1.0.6, and its Android versionCode override changes from 57025 to 57026, with corresponding comments. The app remains HY3N Driver, package `com.hy3n.driver`, EAS project `d19afe45-8e3d-42f9-ad5e-70b12b2c2ce9`.

| Selected platform | Marketing version | iOS build | Android code |
|---|---|---|---|
| Android | 1.0.6 | 124, legacy and unchanged | 57026 |
| iOS | 1.0.3 | 126 | 57023 |
| Web/default | 1.0.2 | 124 | 57023 |

Home, `lib/driver-request-audio.ts` and `assets/audio/incoming-trip-alert.wav` remain byte-identical to the reviewed sound fix. The original request-alert song is retained. No new runtime changes were made to navigation, camera/GPS, automatic photos, API, manual approval, driver types, Call, or the request-player behavior. Expo remains `~54.0.37`, Expo Audio remains `~1.1.1`; package/lock/EAS/plugins/native keys and configuration remain unchanged. The separate iPhone SDK migration is not imported.

## Narrow test maintenance

The exact release-preparation file scope is `app.config.ts`, `tests/driver-android-release-metadata.test.ts`, `tests/driver-android-home-layout.test.ts`, `tests/driver-ios-release-metadata.test.ts`, and this note. No broad directory allowance or application-source changes are permitted.

Historical 57024 and 57025 assertions remain tied to exact historical commits. The stale Home scope guard uses `30f4f1227e2ce56e522722e58c07279bc64308bd^` for its existing historical audio delta, while current Home must equal `30f4f1227e2ce56e522722e58c07279bc64308bd`. All actual current UI, style, interaction and modal checks remain active.

The initial delegated gate had one outdated Android 57025 assertion in the historical iOS metadata test. The parent repaired only that assertion to compare the exact delivered 57025 commit rather than the current 57026 config. Existing iOS, dependency, native-key and other tests remain unchanged. No tests were skipped and no expected behavior was weakened.

## Final local gate

The final parent-owned full run completed at 16:18 UTC: **794 tests, 794 passed, 0 failed, 0 skipped, 0 cancelled and 0 todo**. TypeScript `tsc --noEmit` and `git diff --check` passed. Full all-platform config and exact source comparisons passed, allowing only the two Android version/code literals and their comments. Home, request-audio and song byte-preservation checks passed.

Sanitized local evidence is stored outside the worktree under `/home/ubuntu/hy3n-driver-public-store-release-execution-20261126T1605/`. Git push, the one cloud build, exact finished AAB validation, Play upload and Production review are parent-owned follow-on actions; their actual results belong in the final delivery receipt.

## Release notes and limitations

Approved Android release text: “Updated ride-request alert handling and background playback safeguards, while preserving existing navigation and registration features.”

Local tests do not prove real-device playback quality, native touch geometry, cloud compilation, Apple/Play acceptance or publication. The user chose to release the existing song as-is; sound quality is not represented as perfect or redesigned.

The existing live 57025 Production dashboard displays a potential 16 KB-device crash warning for `libdatastore_shared_counter.so` and an R8 optimisation recommendation. This release does not alter the dependency/native graph to address those separate issues. The new artifact and its actual Play processing warnings must be checked and reported; this note does not assert that those warnings are fixed.
