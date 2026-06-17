# HY3N Rider App TODO

## Core Screens
- [x] Home screen with map placeholder (react-native-maps on device, fallback on web)
- [x] "Where to?" search modal with recent & popular destinations
- [x] Booking sheet with ride categories (Standard, Comfort, Kantanka, Executive, Okada, Express Delivery)
- [x] Payment method selector (Cash, MoMo, Wallet, Card) with correct icons
- [x] Now/Schedule toggle
- [x] Split Fare button
- [x] Promo code input
- [x] Request HY3N button with loading state
- [x] Active ride / Ride Booked screen with Cancel Ride
- [x] Activity tab with ride history (Upcoming/Past tabs), trip detail modal, report issue, book again
- [x] Wallet tab with balance card (Ghana green gradient), stats row, Top Up modal (MoMo/Card/quick amounts), transaction history
- [x] Account tab: profile, loyalty tier/progress, stats, saved places, loyalty rewards, help center FAQ, refer-a-friend, settings
- [x] Safety Center: SOS button, emergency numbers (Police/Ambulance/Fire/HY3N), trusted contacts, safety tips
- [x] Scheduled Trips: upcoming/cancelled cards, cancel/edit actions
- [x] Contact Support: ticket list, new ticket modal with categories, ticket detail modal

## Firebase Integration
- [x] Firebase SDK installed (firebase v11)
- [x] Firebase config connected to Hy3n26 project
- [x] Firebase Auth: Email/Password sign in, sign up, forgot password
- [x] Auth context with user state, riderProfile from Firestore
- [x] Auth gating: unauthenticated users redirected to login screen
- [x] Login screen, Register screen, Forgot Password screen
- [x] Account tab: real user data from Firebase (name, email, loyalty points)
- [x] Account tab: sign out wired to Firebase signOut
- [x] Activity tab: loads real rides from Firestore (RideRequests collection)
- [x] Wallet tab: loads real balance and transactions from Firestore
- [x] Leaflet/OpenStreetMap dark map replacing react-native-maps

## Technical
- [x] react-native-maps web stub (metro.config.js resolver)
- [x] MaterialIcons mapping for payment methods and ride categories
- [x] Tab navigation (Home, Activity, Wallet, Account)
- [x] HY3N branding (logo, splash screen, app name)
- [x] Ghana Cedis (GH₵) fare calculation
- [x] Dark theme with Ghana green (#006B3F) + gold (#D4AF37) + red (#CE1126) colors
- [x] All screens match web app from GitHub repo (https://github.com/yawgad23/Hy3N)
- [x] TypeScript 0 errors

## Remaining for App Store
- [x] Phone OTP login (Firebase Phone Auth)
- [x] Google Sign-In button (works in production build)
- [x] Save ride bookings to Firestore on request
- [x] Real GPS location centering map on user's position
- [x] EAS Build configuration (eas.json) for App Store submission
- [x] Bundle ID set to com.hy3n.rider
- [x] expo-location plugin added to app.config.ts with iOS/Android permissions

## Web App Feature Parity — Remaining Gaps

### Onboarding
- [x] Onboarding slides (5 slides: Book a Ride, Real-Time Tracking, Payment Options, Safe & Secure, Split Fare) — shown once on first launch before login

### Account Screen
- [x] Delete Account option with confirmation dialog
- [x] Dark/Light mode toggle in account settings (UI toggle added)
- [x] Biometric login toggle (Face ID / Fingerprint)
- [x] Privacy Policy & Terms of Use screen (linked from account)

### Home Screen
- [ ] Scheduled trip confirmation toast/banner after booking a scheduled ride
- [x] SOS button visible during active ride (in ride tracker area)
- [x] In-ride chat with driver (quick message templates + free text)

### Activity / History
- [ ] Trip receipt download/share (full breakdown: fare, tip, promo, waiting fee)
- [ ] Ride report modal improvements (match web: rude driver, wrong route, overcharged, lost item, safety concern)

### Notifications
- [x] Push notification service setup (expo-notifications + expo-device)
- [x] Android notification channels (rides, promos, wallet)
- [x] Driver found / arriving / trip started / completed / wallet top-up notifications
- [x] Wire notification toggle in account settings to actual OS permission

### Safety
- [x] Trusted contacts persisted to AsyncStorage

### General
- [x] "Wo ho te sɛn?" Twi greeting on home screen header

## Production Backend & Uber/Bolt Feature Parity

### Real Dispatch Backend (Firestore)
- [ ] Firestore schema: rides collection (status, rider_id, driver_id, pickup, destination, fare, timestamps)
- [ ] Firestore schema: drivers collection (name, vehicle, colour, plate, photo, rating, location, is_available)
- [ ] Real ride request creation — write to Firestore on Book
- [ ] Real driver matching — query available drivers near pickup
- [ ] Real-time ride status listener — onSnapshot for live status updates
- [ ] Real driver location updates — live lat/lng from Firestore
- [ ] Real trip history — load from Firestore rides collection per rider_id
- [ ] Real wallet balance — load from Firestore users collection, start at GH₵ 0.00

### Uber/Bolt Rider UI Features
- [ ] Vehicle colour badge on driver card (e.g. Red, Black, White, Silver, Blue)
- [ ] Driver card: photo placeholder, name, rating, vehicle, plate, colour
- [ ] ETA countdown timer (live seconds countdown to driver arrival)
- [ ] Surge pricing indicator (1.2x, 1.5x, 2x badge on category cards)
- [ ] Cancel policy warning (free within 2 min, GH₵2 fee after)
- [ ] Cancel ride with reason selection modal
- [ ] Ride options: AC toggle, pet-friendly, extra luggage
- [ ] Fare estimate range before booking (show min-max per category)
- [ ] Share trip with contact (share live tracking link via WhatsApp/SMS)
- [ ] Driver is nearby alert (push notification + banner when driver is 2 min away)
- [ ] Ride PIN verification (4-digit PIN rider shows driver before trip starts)
- [ ] Lost & Found contact button in trip details
- [ ] Accessibility option (wheelchair-accessible vehicle request)

## Driver App Feature Parity (vs Web App)

### Settings Tab
- [x] Settings tab created with 5 preference toggles (Push Notifications, Sound Alerts, Auto-Accept, Long Trips Only, Prefer High-Rated Riders)
- [x] Delete Account with two-step confirmation dialog

### History Tab
- [x] Today / This Week filter buttons added
- [x] Expandable trip cards (passenger feedback, payment method, Trip ID)
- [x] Rider name included in search
- [x] Summary row shows Today earnings and This Week earnings
- [x] Result count + earnings shown in filtered list header

### Home Tab
- [x] Notification bell opens Notification Center modal (trip history as notifications)
- [x] High-risk area alert on incoming ride request (Nima, Mamobi, Agbogbloshie, etc.)
- [x] declined_by array updated on decline so driver is not shown same ride again
- [x] driver_accepted_at timestamp written on accept
- [x] is_available: false set on accept, restored to true on complete
- [x] Rider info row on incoming request (name + rating)
- [x] Fare shown prominently on incoming request card

### Post-Trip TripSummaryDialog
- [x] Rate passenger (1-5 stars)
- [x] Optional remarks about passenger
- [x] Found item toggle + description field
- [x] Writes passenger_rating, driver_remarks, found_item to Firestore ride doc
- [x] Creates RideReport doc for found items

### Commission Gate
- [x] Real MoMo number: 0546728330
- [x] Vehicle-type-based fees: GH₵50 (car), GH₵30 (okada/delivery)

## New Features (Jun 17)

### Rider Email Receipt on Trip Completion
- [ ] Server-side email trigger: when driver marks trip complete, send receipt email to rider (fare, route, date, Trip ID, driver name/vehicle)
- [ ] tRPC endpoint: `sendTripReceipt` called from driver app on trip complete
- [ ] Email template: HY3N branded, Ghana Cedis fare, pickup/destination, payment method, Trip ID

### Driver Set Destination
- [ ] "Set Destination" button on driver home screen (when online, no active trip)
- [ ] Allows driver to filter incoming requests to only those heading toward their chosen destination
- [ ] Destination filter applied to incoming ride request listener
- [ ] Clear destination button to remove filter
- [ ] Destination shown as active badge on home screen

### History Tab Share Receipt
- [ ] Share Receipt button inside expanded trip card (completed trips only)
- [ ] Generates plain-text receipt: rider, date, route, fare, Trip ID, payment method
- [ ] Opens native share sheet

## Web App Full Parity Pass (Jun 17 — second pass)

- [x] Earnings tab: correct commission model (100% fare retention, flat daily fee)
- [x] Earnings tab: correct tier thresholds (0/50/150/300)
- [x] Earnings tab: KPI cards (today earnings, this week, avg hourly rate, all-time)
- [x] Earnings tab: week/4-week toggle with bar charts
- [x] Earnings tab: acceptance rate card with progress bar
- [x] Earnings tab: streak/flame card
- [x] Earnings tab: all-time performance summary grid
- [x] Profile tab: correct tier thresholds (0/50/150/300)
- [x] Profile tab: verification checklist card (Identity, License, Vehicle, Background, Phone)
- [x] Profile tab: always-visible safety score with grade circle (A+/A/B/C/D/F)
- [x] Profile tab: hero gradient layout with stats row
- [x] Commission Gate: confirmed/rejected/pending/resubmit state machine
- [x] Commission Gate: 10s auto-poll while pending, auto-advance on confirmed
- [x] Commission Gate: copy MoMo number button
- [x] Notification Center: reads from Firestore notifications collection (primary)
- [x] Notification Center: commission status notifications (confirmed/rejected/pending)
- [x] Notification Center: rating_received and support_reply types
- [x] Notification Center: mark-all-read writes back to Firestore
- [x] Notification Center: unread badges and dot indicators

## Rating & Receipt Features (Jun 17 — round 2)

- [x] Driver post-trip rating modal: add rider-specific quick tags (Friendly, Ready on time, Good communication, Clean entry, Polite, No issues)
- [x] Activity tab: star rating badge already shown on trip cards (rider_rating field) — confirmed working
- [x] Activity tab: Share Receipt button added to trip detail modal (Book Again → Share Receipt → Report Issue)

## Rating Features Parity (Jun 17)

- [x] Driver app: live average rating display updates after rider submits a rating (Firestore subscribeDoc in driver-auth-context)
- [x] Rider app: pending rating prompt on app reopen if a completed unrated ride exists (last 24h check on user load)
- [x] Rider app: comment/feedback text field + quick tags in the rating modal (Great Driver, Smooth Ride, On Time, Clean Car, Professional, Safe Driving)

## Ride History & Account Stats Bug Fix (Jun 17)

- [x] Activity tab queries wrong collection (RideRequests) — fixed to use correct 'rides' collection
- [x] Activity tab uses wrong orderBy field (created_date) — fixed to use 'created_at'
- [x] Activity tab onRefresh doesn't reload rides — fixed to call loadRides()
- [x] Activity tab normalizes destination/pickup from nested objects to flat address strings
- [x] Account tab shows hardcoded '24' total rides — fixed to use real riderProfile.total_rides
- [x] Account tab shows hardcoded '4.9' rating — fixed to use real riderProfile.rating
- [x] handleFinishRide now increments total_rides on riderProfile when a completed trip is dismissed

## Nearby Cars Map Parity (Jun 17)

- [x] Rider home map shows nearby available cars around the user before booking, like the web app
- [x] Rider home map shows a live "cars nearby" indicator when no active ride is in progress
- [x] Driver app writes current_lat/current_lng to Firestore when going online so riders can see nearby cars
- [x] Rider app polls nearby available drivers and passes them into the mobile map component
