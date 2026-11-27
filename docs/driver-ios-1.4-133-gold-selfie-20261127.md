# HY3N Driver iPhone — 1.4 (133), Gold Chime and approved selfie

**Prepared:** 27 November 2026  
**Branch:** `prep/driver-ios-1.4-133-gold-selfie-20261127`  
**Immutable feature source:** `8c3610302610b0578d4787b9b92d085a6be97493`  
**Scope:** iPhone TestFlight preparation only; no public App Store release.

## Release selection and exact source changes

The parent release preflight reported the highest existing Apple/EAS build as **132** and the public Driver **1.3** train as **READY_FOR_SALE**. This candidate therefore uses the next compatible train, **1.4 (133)**. That live preflight is parent-provided; this source-preparation step makes no new Apple/EAS calls.

The only production-source change from the immutable feature source is `app.config.ts`: when `EAS_BUILD_PLATFORM=ios`, version changes from `1.3` to `1.4` and `ios.buildNumber` changes from `132` to `133`. Its two-line release comment now describes the included approved selfie and louder Gold Chime. Every other app-config byte is preserved. Android remains `1.0.3` / `57023`; unspecified and web remain `1.0.2`, with the fallback iOS build number `124` unchanged.

The only other changed paths are `tests/driver-ios-release-metadata.test.ts`, `tests/driver-gold-chime.test.ts`, and this new note. The current release-scope test checks exactly these four paths, combining tracked differences against `8c36103` with untracked additions so it is effective both before and after the parent's commit.

## Included, unchanged feature proof

The approved profile-selfie source from `afaecc548b9e1f2c51b71f9788a331c5207b60a6` remains byte-exact: the real profile screen, `DriverProfilePhoto`, display-only approved-photo helper, auth field typings and all 25 selfie regression tests are retained. Approved registration selfies appear in the existing gold-bordered frame; pending, rejected, unavailable or invalid photos retain the person fallback. No identity documents are used as avatar fallbacks. Details remain in `docs/driver-profile-approved-selfie-20261127.md`.

The louder Gold Chime master remains byte-exact, with SHA-256 **`1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240`**. It is eight seconds of signed 16-bit mono PCM at 44,100 Hz, with the selected `1.0` foreground volume and unchanged looping. Background notification sound remains `default`.

Production Home and the request-audio controller are unchanged, including immediate Accept retirement before the server response and the existing confirmed-assignment, Start, expiry, failure/reconciliation, readiness and background/resume handling. Existing actual-source lifecycle regressions remain byte-exact. Details remain in `docs/driver-gold-chime-20261127.md`; its immutable source validation was **950 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**, with TypeScript passing.

## Native and platform preservation

`eas.json`, dependency manifests, the lockfile, Firebase configuration, native Maps injection and key-alias precedence, scene-aware Apple sign-in, all native plugins, camera/navigation source, registration/photo preparation and unrelated production source remain unchanged. The existing **`production`** EAS profile retains environment **`production`**, iOS configuration **`Release`**, local version source, and exact SDK 27-compatible image **`macos-tahoe-26.6-xcode-27.0`**. Do not substitute the separately named `testflight` build profile, which does not pin this image; the intended destination is TestFlight while the intended build profile is the existing SDK 27 `production` profile.

Historical build-132 metadata is tested against immutable `cc722a6f16b9c9b17be4752a7e8cd2ed0c44061c`, not the new candidate. The original Gold Chime feature scope remains audited between immutable `afaecc5` and `8c36103`. Separate current-source tests allow only exact iPhone `1.4`/`133` metadata/comment replacements and keep all unrelated native bytes protected. No rolling broad allowances, skipped tests or disabled tests are introduced.

New regression checks compare the full evaluated app config with `8c36103` for iOS, Android, unspecified and web across 12 native Maps key scenarios: private/public aliases, precedence, whitespace, missing keys, one-sided keys and mixed aliases. They separately assert exact source-byte replacements, the four-path release scope, unchanged native/configuration/dependency bytes, the SDK 27 production profile, fixed Gold asset hash and retained approved-selfie/Home/controller regression sources.

## Validation and evidence

| Check | Observed result |
|---|---|
| `npm test` | **956 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; exit 0** |
| `npm run check` (`tsc --noEmit`) | **Passed; exit 0** |
| `git diff --check` | **Passed** |
| Exact current release scope including the untracked new note | **Passed in the full suite** |
| Exact metadata-only equivalence across all platform/key scenarios | **Passed in the full suite** |
| Gold master, approved selfie, unchanged Home/controller and native configuration | **Passed in the full suite** |

Full logs:

- `/home/ubuntu/hy3n-driver-ios-gold-selfie-release-20261127/ios-release-tests.log`
- `/home/ubuntu/hy3n-driver-ios-gold-selfie-release-20261127/ios-release-typecheck.log`

The existing SDK 57-pinned `node_modules` symlink is reused without installing or changing dependencies. Deterministic mocked-native regression tests are not physical iPhone/AVFoundation, actual image-download or on-device loudness validation.

## Explicit stops and deferred work

**No mandatory-update implementation or gate is included; the user explicitly deferred it.** No Android source preparation or release is performed here. No backend/Rider deployment, credentials write, build CLI invocation, prebuild, paid build, store upload/submission, public release, Git commit or push is performed in this source-preparation step. Source outside the designated worktree is untouched. The parent owns any later authorized iPhone TestFlight build/submission and Android Production actions.
