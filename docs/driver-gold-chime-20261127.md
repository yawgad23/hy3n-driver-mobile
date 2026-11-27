# Driver Gold Chime — Android source-only change, 27 November 2026

## Choice and volume

This Android-only worktree is based on `fb9d29c9099e3561039bfbce5ab756b981e50730`, including the approved profile selfie. The Driver's selected original **Gold Chime** is retained, with a modestly louder preprocessed master copied byte-for-byte into the existing `assets/audio/incoming-trip-alert.wav` path. No new track was generated and the original `01-gold-chime.mp3` user preview was not modified.

The approved WAV SHA-256 is `1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240`. It is eight seconds of RIFF/WAVE PCM format 1, signed 16-bit little-endian, mono, 44,100 Hz. Preparation used +2 dB pre-limiter gain with a -1 dBFS sample-peak ceiling. Measured mono RMS changed from -17.000 to -15.404 dBFS (1.596 dB measured asset gain); the selected master measures -1.040 dBFS sample peak and has zero clipped samples. Pre-limiter gain is not a claim of a 2 dB measured output increase.

The only production source edit is `INCOMING_TRIP_ALERT_PLAYBACK.volume: 0.92 → 1.0`, within the native 0–1 range. This adds approximately 0.724 dB of playback gain. Existing looping remains enabled. Device media volume, routing, speaker/headphone capability and OS audio policy still determine the final audible level.

## Accept immediately stops request audio

No production Accept/controller refactor was required. Actual Home already force-stops on tap before the unresolved `respondToOffer.mutateAsync` call (baseline Home lines 984–995), and force-stops again before showing the confirmed assignment (lines 956–969). The existing controller cancels its generation/readiness wait, pauses the owned player, disables looping, mutes it, sets volume to zero, unregisters it and releases it. It does not release the empty hook player or globally disable navigation/other audio.

The actual-Home lifecycle harness executes the extracted Home Accept and stop callbacks against the real controller. Tests assert complete ordered retirement before the fake server mutation, including stale JavaScript `playing=false` while modeled native audio is still playing. Added readiness tests cover Accept while the native player is initially loading and while readiness is lost after seek: readiness listeners are removed and late load events cannot play the canceled generation while server acceptance remains unresolved. Accepted stale offers and background/foreground resume remain silent. Existing configure/seek cancellation, accepted-offer suppression and native foreground/media-reset retirement tests remain enabled.

`tests/driver-gold-chime.test.ts` pins the exact chosen-master SHA-256, validates chunk-parsed PCM format/duration (including metadata/odd-byte padding rather than assuming a 44-byte header), sample ceiling, meaningful non-silent content, normalized volume and looping. It executes Android Home's real native factory to verify the unchanged asset path/session options, restricts the incoming-alert source diff to the one exact volume literal and compares all other baseline production/native/config/dependency files byte-for-byte. Historical submitted 57026 and compatibility 57027 old-WAV checks now audit their immutable release commits; all their current Home/controller/map/native/dependency preservation checks remain intact.

## Scope and limits

Home, request-audio controller, maps/navigation, registration/auth/calls, approved profile selfie, notifications, channel/native configuration, dependency versions and lockfile remain unchanged. Background Driver offers retain the default platform notification sound; this change neither adds custom push/channel sounds nor changes request notification contents/prices.

This is a source-only change: no build, version bump, store submission, deployment or real service call was performed. The tested update is being preserved on the dedicated GitHub branch `fix/driver-gold-chime-android-20261127`, without merging or starting a build. Deterministic harness tests prove JavaScript lifecycle/ownership behavior, not actual-device timing or acoustic performance. Replacing or increasing the track is not presented as a fix for any device-specific bug. Physical Android acceptance/loading/background testing remains a release validation step.

Validation completed: `npm test` exited 0 with **841 passed, 0 failed, 0 canceled, 0 skipped**, and `npm run check` (`tsc --noEmit`) exited 0. `git diff --check` also passed. Logs are retained outside the worktree at `/home/ubuntu/hy3n-driver-gold-chime-evidence-20261127/android-tests.log` and `/home/ubuntu/hy3n-driver-gold-chime-evidence-20261127/android-typecheck.log`.
