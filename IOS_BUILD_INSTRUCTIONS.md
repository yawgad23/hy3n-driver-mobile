# iOS Local Development & Compilation Guide

This guide documents how to compile, run, and distribute the iOS version of the HY3N Driver app locally on your Mac, bypassing Expo's cloud build limits.

---

## 1. Initial Compilation (Using Xcode)

Since the native iOS files and CocoaPods are fully generated and linked, you can build the app directly:

1. Open Xcode.
2. Select **File ➔ Open** and choose the workspace file:  
   `/Users/prophetgad/Documents/Projects/hy3n-driver-mobile/ios/HY3NDriver.xcworkspace`
3. Click on the root `HY3NDriver` project in the left sidebar.
4. Under the **Signing & Capabilities** tab:
   * Make sure **Automatically manage signing** is checked.
   * Select your Apple Developer profile/team in the **Team** dropdown.
5. Select your connected iPhone (or a simulator) from the device target dropdown at the top.
6. Press **Command + R** (or click the Play icon) to compile and run.

---

## 2. Daily Development Workflow

### Case A: You only changed JavaScript/TypeScript files
If you are editing layouts, UI styles, or application logic, **do not re-run Xcode**.
1. Run the Metro bundler:
   ```bash
   npx expo start
   ```
2. Reload the app on your phone by typing **`r`** in the terminal.

### Case B: You installed a new native library
If you run `npx expo install <package>` and it has native iOS dependencies:
1. Regenerate native config files:
   ```bash
   npx expo prebuild --platform ios --no-install
   ```
2. Update CocoaPods dependencies (ensure the UTF-8 environment is exported):
   ```bash
   cd ios
   export LANG=en_US.UTF-8
   export LC_ALL=en_US.UTF-8
   pod install
   ```
3. Open Xcode, clean the project (**Command + Shift + K**), and rebuild (**Command + R**).

---

## 3. Creating a Release (.ipa) or TestFlight Upload

1. Open the workspace in Xcode.
2. Select the active target dropdown at the top and set it to **Any iOS Device (arm64)**.
3. Go to the top menu bar and select **Product ➔ Archive**.
4. Once compilation finishes, the Organizer window will open:
   * Click **Distribute App** to sign and export it as an Ad-Hoc `.ipa` file.
   * Or choose **App Store Connect** to upload it directly to TestFlight.
