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
