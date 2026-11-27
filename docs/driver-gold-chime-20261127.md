# Driver Gold Chime — iPhone source update, 2026-11-27

## Choice and volume

The selected original **Gold Chime** replaces `assets/audio/incoming-trip-alert.wav` using the exact supplied `gold-chime-louder.wav` master. It is eight seconds of PCM format 1, signed 16-bit little-endian, mono, 44,100 Hz. The approved original preview remains unmodified.

Master SHA-256: `1314bc6b6424a7461254d847b2a95d7742dc745cbf43cafe01e3bfd1fed46240`.

The supplied processing used +2 dB pre-limiter gain with a -1 dBFS sample-peak ceiling. This is **not** a claim of +2 dB measured gain: the mono original RMS measured -17.000 dBFS and the approved master -15.404 dBFS, a measured increase of approximately 1.596 dB. The master sample peak is -1.040 dBFS with zero clipped PCM samples. Foreground `INCOMING_TRIP_ALERT_PLAYBACK.volume` changes only from `0.92` to `1.0` (approximately another 0.724 dB of player gain), within the native 0–1 range. Existing looping remains enabled while an eligible request is unanswered.

## Immediate stop on Accept

The existing production Home and request-audio controller are byte-identical to baseline `afaecc548b9e1f2c51b71f9788a331c5207b60a6`. No stop logic refactor was needed: Home already force-stops on Accept before its server mutation and force-stops again on confirmed assignment before showing the active trip.

The actual-source Home harness executes the current native player factory, playback callback, stop callback, Accept handler and playback/AppState effects. Tests assert synchronous pause, unloop, mute, volume zero, remove/unregister and release **before the unresolved mock server response**, including when native playback is audible but JavaScript status is stale. New tests cover Accept while initial native readiness is still loading and while readiness is lost after seek: readiness listeners are cancelled, pending generations cannot play after a late load event, and native resume cannot revive the retired request. Confirmation must issue a second force-stop before active-trip state. Existing accepted-stale-offer, failure/reconciliation, Start, expiry and background/resume tests remain enabled.

`tests/driver-gold-chime.test.ts` protects the fixed approved master hash, parses RIFF chunks including metadata and odd-length padding (no assumed 44-byte header), verifies exact format/duration, audible nonzero PCM, RMS, sample-peak ceiling and zero clipping, and asserts the exact single playback-volume source change. Its release-asset audit reads immutable build 132 history; it does not force the current chosen sound to retain the old release asset hash. It also protects unchanged native/configuration and unrelated production source against the baseline.

## Scope and limits

Background notifications retain the platform `default` sound. No custom channel, push/native configuration, notification prices, shared audio-disable behavior, map/navigation/camera, registration/auth, approved profile selfie or Call changes are made. The only production changes are the WAV and the single foreground volume setting.

This is a source/test preparation only: no build, version/build-number bump, store submission, deployment or real service call. The tested update is being preserved on the dedicated GitHub branch `fix/driver-gold-chime-ios-20261127`, without merging or starting a build. Device media volume, output route, hardware and operating-system settings still control final loudness. Deterministic mocked native lifecycle checks are not physical iPhone/AVFoundation validation; changing the track is not proof that a reported physical-phone issue is solved. Full `npm test` and `npm run check` evidence is recorded separately in `ios-tests.log` and `ios-typecheck.log` in the Gold Chime evidence directory.

## Validation result

`npm test`: **950 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**. `npm run check` (`tsc --noEmit`): **passed, exit 0**. The full suite retains all existing release, accepted-stale-offer and background/resume checks, with nine new Gold Chime asset/scope tests and six new actual-Home Accept retirement/readiness tests.
