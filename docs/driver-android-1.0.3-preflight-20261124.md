# Driver Android 1.0.3 (57023) release preparation

24 November 2026 · Manus AI

## Prepared source

This metadata update sits on the tested Android route, acceptance-audio, bottom-action and turn-banner fixes at `6966f8c4069d6cc7f009d983d7c3ffe39636df15`. The underlying complete Driver suite passed 362/362 before the metadata update. The earlier keyboard, rating safe-area and action-sizing fixes remain included.

`app.config.ts` now selects version 1.0.3 for `EAS_BUILD_PLATFORM=android`, with Android version code 57023. Unspecified and iOS configurations retain version 1.0.2 and iOS build 124. The Android release CLI command must set `EAS_BUILD_PLATFORM=android` locally because EAS provides it automatically on native workers, but not during ordinary local configuration evaluation. No stored environment variables, iOS source or Rider source changed.

A source-only configuration check passed 22 assertions: Android version/package/code, unchanged complete iOS/default configuration apart from irrelevant Android version-code metadata, preserved Navigation plugin with synthetic keys, and unchanged production profile and submit track. TypeScript and `git diff --check` passed. No native prebuild or compilation has occurred.

## Verified release access

Google Play's complete bundle list shows 57022 as the highest uploaded Driver code. Production 1.0.2 (57022) is available on Play with a 100% rollout. Code 57023 is unused as of the read-only check.

Both native Maps public aliases are nonempty in the Driver EAS production environment, with corresponding secret aliases also listed. Their values and restrictions were not changed. EAS CLI authentication is restored as yawgad, limited to Release Manager access on yawgad only. Existing JKS signing credentials are available. No Play submission service account is assigned in EAS, so the planned upload uses the authenticated Google Play Console, not the missing local service-account path.

Production targets 177 of 178 available country entries, including Rest of world. Albania is the single excluded country. Completing worldwide availability means adding Albania while preserving all existing selections, subject to the final release approval.

## Important boundaries

The registration selfie upload exists, but the backend accepted-ride snapshot still omits the canonical `profile_photo_url` fallback. That backend photo linkage is **not fixed or included** in this Android build scope. Manual Driver approval remains unchanged.

Google Play flags an existing 16 KB native-library warning for `base/lib/arm64-v8a/libdatastore_shared_counter.so` in live build 57022. Current source already pins NDK 28, so that setting alone must not be presented as a verified repair of a precompiled dependency. A read-only inspection of the existing AAB is separate from the four app fixes. The warning does not establish that Play will reject an upload, and physical-device behavior remains unverified. Do not claim it is resolved without artifact evidence.

No new build, archive, upload, submission, deployment or OTA has started. Final exact approval is still required for one Android production AAB and its Google Play Production submission.

## Sources

- [Expo built-in build variables](https://docs.expo.dev/eas/environment-variables/usage/)
- [Driver EAS build history](https://expo.dev/accounts/yawgad/projects/hy3n-driver-app/builds)
- [Driver production environment](https://expo.dev/accounts/yawgad/projects/hy3n-driver-app/environment-variables)
- [Driver Play bundle history](https://play.google.com/console/u/0/developers/7996933261067033148/app/4972068614011961956/bundle-explorer-selector)
- [Driver Production track](https://play.google.com/console/u/0/developers/7996933261067033148/app/4972068614011961956/tracks/production)
