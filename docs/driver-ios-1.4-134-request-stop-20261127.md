# HY3N Driver iPhone 1.4 (134) — request audio stop

Prepared 27 November 2026 after explicit user authorization to build the iPhone fix using SDK 27 and upload it to TestFlight.

Apple App Store Connect and EAS were checked immediately before preparation. Both highest build counters were 133; EAS reported no active iPhone builds. Marketing version stays 1.4 and only the iPhone build counter changes to 134. Android, web and unspecified-platform metadata remain unchanged.

This release includes the tested correction commit `d3988e1fcf538e09948b591e552bc10a14a73b81`. Accept stops all request-chime owners in the session before mutation and before showing the confirmed trip. Assigned-trip restoration, Start and pickup-code verification also stop request audio. Stale accepted requests cannot restart through another retained Home controller or remount. The iPhone native player-specific terminal stop invalidates loop/reset/seek/ready/resume work and does not deactivate navigation's shared audio session on the successful patched path. Failed-Accept rearm requires fresh server evidence plus current eligibility.

Keep the selected louder Gold Chime unchanged. Preserve map/navigation, camera and vehicle motion, registration/manual admin approval, approved profile photo, location/background notifications and auth. No forced-update configuration, Android build, API/admin/website/Rider deployment, new beta group or public App Store review submission is authorized by this release.

Use the existing `production` EAS build profile with image `macos-tahoe-26.6-xcode-27.0`, local version source and no auto-increment. Submit this exact build through the existing iOS production submission credentials, but destination is TestFlight only. Verify the actual IPA SDK/Xcode stamps, identity and packaged Gold Chime before upload. Make at most one cloud build; inspect a failure or uncertain launch before proposing a replacement.

The correction passed 1,062 local tests before the counter bump. Re-run the full release suite and TypeScript before launch. Copied Swift fixture/structural checks are not a native compilation or acoustic device test. A successful EAS build provides compilation evidence; final phone validation is still needed.

## What to test on the iPhone

Install 1.4 (134), confirm the Gold Chime starts for a new offer, and Accept normally. The trip should appear and the request sound should stop, including at a loop boundary. Confirm navigation voice still works. Repeat with a delayed/lost network response and a background/foreground or reopened assigned trip. Start and pickup-code verification must remain silent. After completing a trip, a genuinely new request should ring normally. A failed/unassigned Accept may ring again only when the server freshly confirms failure and the same request is still eligible.

The observed build 133 continuous-loop root cause was not conclusively reproduced on a physical phone. Do not claim that the acoustic incident is resolved solely because local tests and compilation pass.
