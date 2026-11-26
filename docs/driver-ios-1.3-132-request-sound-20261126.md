# HY3N Driver iPhone 1.3 (132): request-song retirement

Date: 2026-11-26

## Authorized release scope

The user approved **one iPhone cloud build of HY3N Driver version 1.3, build 132, using the existing SDK 27 / Xcode 27 configuration, followed by TestFlight upload only**. This approval does not authorize an Android build or release, a public App Store submission/release, another build attempt, or unrelated source changes. The parent release task owns the `app.config.ts` build-number bump, commit/push, cloud build and TestFlight upload. This note is preparation evidence, not a claim that the build, upload or TestFlight processing has completed.

The reviewed request-sound source is `05754fe2ccc966c096000c42b8d20e574991ec1f`, based on delivered iPhone 1.3 (131), `e4fd60fef058866ea57ad65295ca33a89893f90a`. Preparation for 132 is limited to `app.config.ts`, `tests/driver-ios-release-metadata.test.ts`, the exact scope-guard update in `tests/driver-android-home-layout.test.ts`, and this new note. The effective iOS configuration changes only `ios.buildNumber` from `131` to `132`; the iOS version remains `1.3`. Android, default and web configuration remain exactly as at the reviewed sound-fix commit.

## Request-song fix carried into 132

The incoming-request song is the **same bundled `assets/audio/incoming-trip-alert.wav`**. Its foreground request playback retains looping, volume `0.92`, playback in silent mode, `duckOthers`, no recording, no earpiece routing, `shouldPlayInBackground: false` and `keepAudioSessionActive: false`. No replacement song, notification sound or global audio-session shutdown is introduced.

Accept force-stops the request source before the action proceeds. The stop is no longer dependent only on a possibly stale JavaScript `playing` value or a later render/effect. All valid trip-start paths also force-stop synchronously: the initial Start tap stops before opening pickup-code entry or entering the normal start path; `beginTrip` stops before pending state/server mutation; and **Verify & Start** stops before pending state/verification-and-start mutation. Invalid and duplicate action guards remain in place. A failed trip start does not invent a request-song replay. The existing failed-Accept reconciliation can explicitly rearm only the same still-eligible, unanswered offer.

Native request playback is owned by a fresh, request-only player per offer. Terminal retirement cancels pending readiness, invalidates asynchronous generations, pauses forcibly, disables looping, mutes and zeros volume, then attempts native `remove()` and `release()` independently so one failed operation does not skip the other. This removes the request player's native resume/reset ownership and retires pending seeks/observers instead of retaining a paused source that could play again. The empty hook-owned player is not manually released, and unrelated audio players are not shut down.

On inactive/background transitions, Home synchronously suspends and unregisters the live request source rather than waiting for React to render. Resume can create a new source only for an unanswered offer that is still eligible; a background event after successful Accept cannot clear the consumed iOS offer latch. Playback checks current driver identity, location eligibility, online/sound preferences, current offer ID, active trip, in-flight action, accepted-offer suppression, offer expiry, lease validity and matching preferences. These checks and generation guards run again after audio configuration, native readiness and seek so old asynchronous work cannot start the song after Accept, expiry, reassignment, loss of eligibility or a background transition. Background push notifications and authenticated location publishing are preserved; foreground song suspension does not disable them.

The reviewed sound fix includes shared native iOS/Android lifecycle protection. Carrying that reviewed source into this iPhone build is not authorization to build, upload or release Android, and it does not change Android/default/web release configuration.

## Preserved prior behavior and release guards

The delivered 131 map camera, follow-camera cadence, heading stabilization, route projection, reroute behavior and camera regression tests remain byte-for-byte unchanged. The automatic registration-photo preparation, document-recovery behavior, existing manual admin verification workflow, and mobile-network **Call** action are carried forward without redesign or removal. Home itself is compared to the reviewed sound-fix source, not the stale build-126 Home baseline; unrelated banner/theme/navigation/GPS files retain their existing historical comparisons.

The metadata suite retains the historical build-130 and version-train checks and adds an exact historical 131 assertion against its delivered commit. Its current 132 comparison permits only the iOS build-number change, with both populated and empty client-key environments across iOS, Android, default and web. The current whole-worktree guard compares to `05754fe2ccc966c096000c42b8d20e574991ec1f` and permits exactly the four preparation paths above, including untracked files. The wider comparison from historical build 130 explicitly enumerates the previously reviewed camera files and the two audio source files plus five sound-fix regression files; it is not a broad source allowlist or permission for fresh camera/audio changes.

Existing SDK 27 compatibility, Expo SDK 57 package matching, Maps key injection/alias precedence, native Maps and SDK plugins, scene-aware Apple sign-in, Firebase/module pins, backend revision, dependency/lock preservation and exact EAS image checks remain active. The EAS production iOS image remains `macos-tahoe-26.6-xcode-27.0`. No failing guard is skipped or disabled.

## Local validation and limits

Preparation validation command, run after the parent updated `app.config.ts`:

```sh
cd /home/ubuntu/hy3n-website-visual-refresh && \
  cd /home/ubuntu/hy3n-driver-release-prep-ios-20261126 && \
  node --import tsx --test tests/driver-ios-release-metadata.test.ts
```

Local result on 2026-11-26: **19 tests passed; 0 failures, 0 skipped, 0 cancelled**. `git diff --check` also passed. This preparation check verifies effective configuration and Git/source preservation; it does not compile an iOS binary or prove device behavior.

The initial full suite passed 909/910, with one historical Home scope proof still expecting the pre-retirement iOS hook source. The guard now asserts current Home is byte-identical to the reviewed sound-fix commit, preserves the original delivered-131 layout/logic proof against that exact historical source, and continues to check current styles/modals and render current JSX in all other UI tests. No test is skipped and no application source is changed by this guard correction.

The reviewed sound-fix regression files cover actual Home handler ordering, stale JavaScript playback status, native-player retirement, background/media-reset models, asynchronous configuration/readiness/seek cancellation and offer lifecycle. Their native lifecycle fixtures are deterministic models, not AVFoundation/device tests. In particular, the retained-player baseline models a one-shot reset replay and does not establish the full cause of the reported continuous incident. These audio suites are not newly claimed as executed by this metadata/note preparation task.

On-device confirmation remains necessary for the exact request-song stop after Accept, initial Start and Verify & Start; delayed readiness/seek; background/foreground transitions; interrupted playback/media recovery; and an eligible later request still playing the same song. Cloud compilation, signing, TestFlight upload/processing and live camera/photo/admin/Call checks are outside local metadata-test proof and remain the parent release task's responsibility. No cloud build, prebuild, upload, API action, Android release or public-store submission is performed by this preparation subtask.

## Final parent release validation

At 2026-11-26 14:28 UTC, the complete local suite (`node --import tsx --test tests/*.test.ts`) passed **910/910**, with zero failures, skips or cancellations. TypeScript (`tsc --noEmit`) and `git diff --check` passed. The exact Home preservation assertion and all current UI/audio/camera/registration regression tests were included. This validates local source and release preparation, not native device playback or cloud compilation. The initial 909/910 result remains recorded above; the final corrected run supersedes it.
