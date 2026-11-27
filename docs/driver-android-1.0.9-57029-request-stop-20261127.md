# Driver Android 1.0.9 (57029) — request-sound stop

Ports the tested session-wide request-audio cancellation, bounded consumed-offer ledger and server-only failed-Accept reconciliation into the delivered Android SDK54 baseline. Explicit stops cover Accept, assignment, active-trip restoration, signout and Start. A genuinely failed eligible request can re-arm only after fresh unassigned server evidence and current Home eligibility.

The exact louder Gold Chime, navigation/maps/camera/car, registration/manual approval, profile selfie, auth, Driver types/Call, DataStore1.2.1/16KB plugin and all dependencies/native plugins remain unchanged. No iPhone SDK57 config or native hook is installed on Android.

Android version/counter alone change to1.0.9/57029; iPhone/web/default metadata and all Maps-key/plugin configurations remain unchanged. Historical57028 audit remains strict, with exact two-replacement metadata normalization plus independent raw57029 configuration and whole-source tests.

One Production AAB cloud build is planned for Google Play Production review, all178 countries/regions, Managed Publishing ON. No replacement build/retry is authorized automatically. Actual AAB identity/signing/Gold/API36/DataStore/16KB gates must pass before upload. Local modeled tests and static alignment checks do not prove physical acoustic silence or physical16KB-device runtime behavior.

## en-GB release notes

Fixed the request alert so the Gold Chime stops when accepting a ride, restoring an active trip or starting a trip. Improved protection against stale or duplicate request-audio playback while preserving existing navigation and driver features.
