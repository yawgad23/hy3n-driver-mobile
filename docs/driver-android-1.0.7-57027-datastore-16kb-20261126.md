# HY3N Driver Android 1.0.7 (57027): DataStore 16 KB compatibility

This Android-only release adds a durable Expo config plugin constraining `androidx.datastore:datastore-core` to the official infrastructure-patched `1.2.1` release. AndroidX atomic-group constraints align the already-used DataStore family. The corrected prebuilt native library is supplied by Maven during the normal signed build, not replaced inside an AAB after signing. Changing only the app NDK would not recompile this dependency.

The submitted Android source baseline is `e3e7b3f17c472fd7971fbc708dcbbcc1a7222165`, version 1.0.6 (57026). Google Play and EAS were checked on 26 November 2026 before selecting 57027. At the source-preparation check, 57026 was Google's latest uploaded counter and was approved but held by Managed Publishing; 57025 remained available on Google Play. This document is source preparation, not proof that 57027 has been built, uploaded, approved or published.

## Changes and preservation

Only Android release metadata, the new Android-only plugin, compatibility tests, historical metadata test guards and this release note change. The plugin is independent of Maps key availability, appends one scoped Gradle constraint, is idempotent, and rejects altered or duplicate marker blocks.

The current song, request-audio stopping behavior, Home/map/car movement/camera source, Driver registration and photo flow, manual administrator approval, Driver types and Call controls remain unchanged. The Navigation plugin, React Native/Expo/Firebase/npm versions, lockfile, Firebase files and EAS production profile remain unchanged. iOS, web and unspecified Expo configurations are preserved exactly. No new iPhone build is part of this release.

The previous DataStore arm64 library's GNU RELRO region ends at `0xd000`, not a 16 KB boundary. The official 1.2.1 library ends at `0xc000` and keeps writable data separately. The previously submitted AAB already used `PAGE_ALIGNMENT_16K`; this patch addresses the dependency's native memory layout rather than pretending packaging alignment alone fixes it. Official DataStore 1.2.1 release notes describe infrastructure-only changes, with no API or behavior change.[1]

## Release gates

Run the complete local test suite, TypeScript and diff checks, and regenerate Android prebuild twice to check metadata and plugin idempotence. The prior standalone Gradle metadata experiment aligned 13 runtime DataStore modules from 1.2.0 to 1.2.1 without adding/removing unrelated modules; that experiment is not a full-app runtime dependency graph.

A native dependency change requires a new binary. The user authorized at most one new Android build on 26 November 2026 at 18:48 UTC. Use the existing production AAB profile and existing credentials, from the exact pushed commit, without auto-submit or a second paid APK build. Verify the finished AAB identity, signature, original song, target API, actual packaged dependency metadata, all arm64 LOAD and RELRO layouts, and bundle packaging. Deriving APKs from this same AAB with bundletool does not require another EAS build.

Read Google Play's 16 KB result for the exact uploaded 57027 bundle before claiming Play compatibility. Runtime validation on a true ARM64 16 KB boot remains a separate gate: `adb shell getconf PAGE_SIZE` must return `16384`, compatibility fallback must be disabled where supported, and existing app flows must be exercised without real ride or administrator side effects. Compare with a 4 KB device. This sandbox lacks a supported Linux ARM64 emulator package and KVM, so local artifact checks must not be called device testing.

The optional deobfuscation-file notice is not the DataStore failure. This release does not enable R8/shrinking or upgrade AGP/React Native just to hide an informational notice; those unrelated changes would increase regression risk. Never upload a fabricated mapping file. Leave the approved 57026 release and Managed Publishing untouched unless the user authorizes replacing its Production submission.

## Google Play release notes

Improved Android compatibility on devices using 16 KB memory pages. Includes the latest request-alert fix while keeping the existing sound, navigation and Driver registration improvements.

## References

[1]: https://developer.android.com/jetpack/androidx/releases/datastore "AndroidX DataStore release notes"
[2]: https://developer.android.com/guide/practices/page-sizes "Android support for 16 KB page sizes"
