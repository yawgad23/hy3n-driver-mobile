# HY3N Driver Android 1.0.8 (57028): Gold Chime and approved selfie source preparation

**Prepared:** 27 November 2026. **Status:** Tentative metadata only; no build, upload, submission or publication.

## Immutable source and metadata

The exact release-source base is `ddc51e85fd38bac97b416103678aa4eaaf61b9a6`, which already includes the louder selected Gold Chime and administrator-approved profile selfie. Preparation is isolated to branch `prep/driver-android-1.0.8-57028-gold-selfie-20261127`.

Only Android-conditional marketing version `1.0.7 → 1.0.8` and versionCode `57027 → 57028`, plus their comments, change. Android package remains `com.hy3n.driver`, and the unchanged EAS production profile produces an app bundle for the Android Production track. iPhone remains 1.0.3/build 126; web/unspecified remains 1.0.2 with iOS build 124 and Android code 57023. All other evaluated platform configuration is exact to the immutable base, both with and without synthetic Maps keys.

## Exact scope and proof

The only release-preparation paths are:

- `app.config.ts`
- `tests/driver-android-datastore-16kb.test.ts`
- `tests/driver-gold-chime.test.ts`
- `tests/driver-android-57028-release-metadata.test.ts`
- This release note.

Historical DataStore metadata/text proof now reads the immutable 57027 release `7c476da16724e22d2e1c11d49cde2806b3650a65`. Historical Gold Chime proof reads `ddc51e85fd38bac97b416103678aa4eaaf61b9a6` against its approved-selfie base `fb9d29c9099e3561039bfbce5ab756b981e50730`, with an exact ten-path feature allowlist. Current 57028 tests enforce an exact five-path metadata/test/doc allowlist, full evaluated config equality with only the two Android metadata exceptions, exact config text replacements and byte-preservation of every other base file, including historical tests/docs. No tests are skipped, and there are no directory-wide release exceptions.

Expo SDK 54 (`~54.0.37`), dependencies, lockfile, EAS configuration and DataStore 1.2.1 constraint plugin are unchanged. Navigation, maps/car movement/camera, registration/document photos/manual approval, auth, Call, profile/selfie, request-audio controller/Home/native source and the exact Gold Chime WAV are unchanged. The WAV SHA-256 remains `1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240`; playback remains volume 1, looping, with default background notification sound.

## Build gate and validation limits

The user authorized Android Production, but **no build may start until the parent confirms the current Google Play counter and validates 57028**. The delegated starting context reports Play API 403 and the browser signed out; neither channel was accessed during this preparation. This versionCode is tentative, not a verified store allocation. If Play requires another counter, the metadata, exact tests and release note must be updated and validated before any build.

The parent owns source review, commit and any later build or store operation. This preparation performs no commits, push, builds, submissions, browser/API/store/credential operations, deployment or other-worktree changes. JavaScript tests and TypeScript checks are not physical-device, acoustic, 16 KB runtime, Play compatibility or publication proof. Approved selfie linkage to Rider assignments remains dependent on the separately documented backend deployment; it is not performed here.

Full test, TypeScript, diff and source-preparation evidence is retained outside the worktree under `/home/ubuntu/hy3n-driver-dual-gold-selfie-release-20261127/android/`; the final `prep-report.md` records measured counts and exit codes.
