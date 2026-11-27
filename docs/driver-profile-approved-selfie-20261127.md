# HY3N Driver — approved selfie on the profile screen

**Prepared:** 27 November 2026  
**Status:** Implemented and locally tested; no app build, upload or deployment started.  
**Repository:** `yawgad23/hy3n-driver-mobile`

## User-visible behavior

The Driver Profile hero now displays the administrator-approved registration selfie instead of always showing the generic person icon. The image uses an 82 × 82 layout-unit gold-bordered frame, with a rounded, cover-cropped photo. The registered `profile_photo_url` takes precedence over historical `avatar_url` and `photo_url` fields.

Pending and rejected applications keep the placeholder icon. Explicit application decisions override historical approval booleans. Missing, malformed, local, non-string or credential-bearing photo values are not loaded. The existing person icon is also used if image loading fails. Image-error state resets when the photo URL, authenticated account or selected profile changes, so an earlier account's failed image cannot hide a later account's selfie.

The existing authenticated profile reads and realtime profile subscription already retain the saved selfie field. Approval or photo changes therefore use the existing profile refresh flow; no new public profile endpoint, upload, or account mutation was introduced. The new helper is display-only and does not grant online, ride-acceptance or other operational permissions.

Ghana Card, licence, vehicle verification and other document fields are never selected as avatar fallbacks. Drivers cannot bypass manual administrator approval or silently replace the approved selfie through this screen. There is no new photo-edit/upload control in this update.

## Platform source isolation

- Android branch: `fix/driver-profile-selfie-android-20261127`, based on `7c476da16724e22d2e1c11d49cde2806b3650a65` (the Driver 1.0.7 / 57027 DataStore 16 KB source).
- iPhone branch: `fix/driver-profile-selfie-ios-20261127`, based on `cc722a6f16b9c9b17be4752a7e8cd2ed0c44061c` (the Driver 1.3 / 132 source).

The profile screen, photo helper, photo component, profile field typings and new tests are identical across these branches. They were applied separately rather than merging Android's dependency/native configuration into the iPhone SDK 27 release branch.

Changed application files are limited to `app/(tabs)/profile.tsx`, a two-field typing addition in `lib/driver-auth-context.tsx`, `lib/driver-profile-photo.ts`, and `components/DriverProfilePhoto.tsx`. Auth loading and sign-out logic were not changed.

Map, car movement, camera, navigation, request audio/song, registration, document reupload, Driver types, Call, payments and fees remain unchanged. `app.config.ts`, `eas.json`, dependencies/lockfile and native plugins are byte-identical to each platform's own baseline. No version or build number was bumped. The protected prior release worktrees remain clean and untouched.

## Validation

| Check | Result |
|---|---|
| Android full Driver suite | **827 passed, 0 failed, 0 skipped** |
| iPhone full Driver suite | **935 passed, 0 failed, 0 skipped** |
| New selfie-selection and rendered-profile tests | **25 passed** on both platform suites |
| Android/iPhone TypeScript `tsc --noEmit` | Passed |
| `git diff --check` | Passed |
| Cross-platform implementation equality | Passed |
| Unrelated feature/native-config preservation | Passed |

The new tests cover selection precedence, approval normalization and stale booleans, safe legacy fallbacks, invalid/private-document inputs, actual profile-screen pending-to-approved-to-rejected updates, platform rendering, image-error fallback, fresh photo/account state and stale image callbacks. Runtime tests use React Test Renderer with controlled native/auth/router mocks; no actual Driver records or photographs were accessed.

The first full-suite runs detected two historical release-scope assertions on each platform that compared an old release against the current worktree and rejected any later feature. Android's historical scope now compares the immutable 57027 commit, and iPhone's compares the immutable 132 commit. The exact release allowlists remain checked (including exact-set checks where applicable); existing current-source map/audio/registration/native byte-preservation checks remain intact. No tests were skipped or disabled to obtain the final passing runs.

No real iPhone/Android device image-download or layout test was performed. The React runtime checks and TypeScript do not replace that final on-device acceptance check.

## Release implications

This is a Driver-app source update. It will appear after a future authorized Driver build is installed; currently installed apps are unchanged. Builds, store uploads, version selection and deployment remain separate actions.

The separate Rider-card backend fix, commit `72a66d7048db64029ad1012a6d7ef6a175b9c3d9` in `yawgad23/backend`, still requires API deployment before new Rider assignments receive the selfie. It was not deployed as part of this Driver profile change.
