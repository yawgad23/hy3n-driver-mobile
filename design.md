# HY3N Rider App - Mobile Interface Design

## Overview
HY3N is a ride-hailing mobile app for riders to book trips, view available ride categories, and see real-time fare estimates. The app focuses on simplicity and quick ride booking with competitive pricing.

## Screen List

### 1. **Home Screen (Main Booking Interface)**
- **Purpose**: Primary screen where users book rides
- **Content**: 
  - Map view showing current location
  - "Where to?" destination input field
  - Ride category selector (Standard, Comfort, Kantanka, Executive)
  - Real-time fare estimate display
  - "Book Ride" button
  - Recent locations / favorites (optional)

### 2. **Ride Details Screen**
- **Purpose**: Show trip confirmation and details before booking
- **Content**:
  - Pickup location
  - Dropoff location
  - Selected ride category with vehicle details
  - Estimated fare breakdown (base fare, distance, time)
  - Estimated trip duration
  - Driver details (after booking)
  - "Confirm Booking" button

### 3. **Active Trip Screen**
- **Purpose**: Track ongoing ride
- **Content**:
  - Live map with driver location and route
  - Driver name, photo, rating
  - Vehicle details (plate number, model)
  - Estimated arrival time
  - Trip progress (pickup → dropoff)
  - Contact driver button
  - Cancel trip option

### 4. **Trip History Screen**
- **Purpose**: View past trips and receipts
- **Content**:
  - List of completed trips with dates
  - Trip summary (from, to, fare, duration)
  - Rating and review option
  - Receipt view/download
  - Reorder ride button

### 5. **Profile Screen**
- **Purpose**: User account and settings
- **Content**:
  - User name and profile photo
  - Emergency contacts
  - Payment methods
  - Ride preferences (music, temperature, etc.)
  - Settings (notifications, language, dark mode)
  - Help & Support
  - Sign out

## Primary Content and Functionality

### Home Screen (Booking)
- **Map Integration**: Display current location and allow map interaction
- **Location Input**: Autocomplete for pickup and dropoff addresses
- **Category Selection**: Horizontal scrollable list of ride categories with prices
- **Fare Calculation**: Real-time fare estimate based on distance and time
- **Quick Actions**: Recent locations, saved places, favorites

### Ride Categories
- **Standard**: Most affordable option (GH₵87 for 18.4 km)
- **Comfort**: Mid-range with better vehicle (GH₵100 for 18.4 km)
- **Kantanka**: Premium comfort (GH₵100 for 18.4 km)
- **Executive**: Luxury option (GH₵130 for 18.4 km)

### Pricing Formula
- Base Fare + (Distance × Per-KM Rate) + (Duration × Per-Minute Rate)
- Rates vary by category and are fetched from hardcoded constants

## Key User Flows

### Flow 1: Book a Ride
1. User opens app → Home screen displays
2. User taps "Where to?" and enters destination
3. System calculates route and shows fare estimate
4. User selects ride category
5. User taps "Book Ride"
6. Ride Details screen shows confirmation
7. User taps "Confirm Booking"
8. Active Trip screen shows driver assignment and real-time tracking
9. Driver arrives and completes trip
10. Trip History updated with receipt

### Flow 2: View Trip History
1. User taps "History" tab
2. List of past trips displayed with summaries
3. User taps a trip to view full details and receipt
4. User can rate and review the trip

### Flow 3: Manage Profile
1. User taps "Profile" tab
2. User can view/edit personal information
3. User can manage payment methods
4. User can adjust preferences
5. User can access help and sign out

## Color Choices (HY3N Brand)

- **Primary**: Deep Blue (#0a7ea4) - Trust, reliability, professional
- **Accent**: Vibrant Orange (#FF6B35) - Energy, action, call-to-action
- **Background**: Clean White (#FFFFFF) / Dark (#151718)
- **Surface**: Light Gray (#F5F5F5) / Dark Gray (#1e2022)
- **Success**: Green (#22C55E) - Trip completed, confirmation
- **Warning**: Amber (#F59E0B) - Alerts, important info
- **Error**: Red (#EF4444) - Cancellations, issues
- **Text**: Dark Gray (#11181C) / Light (#ECEDEE)

## Layout Principles

- **Mobile Portrait (9:16)**: All screens optimized for portrait orientation
- **One-Handed Usage**: Key buttons positioned in lower half of screen for thumb reach
- **Safe Area**: Content respects notch and home indicator
- **Tab Navigation**: Bottom tab bar for Home, History, Profile
- **Minimal Scrolling**: Prioritize content above the fold
- **Haptic Feedback**: Subtle vibration on button taps and confirmations
- **Accessibility**: Large touch targets (44pt minimum), high contrast text
