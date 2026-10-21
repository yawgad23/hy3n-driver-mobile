const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withDangerousMod,
  withGradleProperties,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'with-google-navigation';
const DESUGARING_DEPENDENCY = "coreLibraryDesugaring('com.android.tools:desugar_jdk_libs_nio:2.0.4')";
const DRIVER_CAR_MARKER_SOURCE = path.join('assets', 'images', 'driver-map-car-marker.png');
const ANDROID_DRIVER_CAR_MARKER = 'hy3n_driver_car_marker.png';
const IOS_DRIVER_CAR_MARKER = 'HY3NDriverCarMarker';
const IOS_NAVIGATION_VIEW_CONTROLLER_SOURCE = path.join(
  'node_modules',
  '@googlemaps',
  'react-native-navigation-sdk',
  'ios',
  'react-native-navigation-sdk',
  'NavViewController.mm',
);
const IOS_DISABLE_DEFAULT_LOCATION_INDICATOR_MARKER = 'HY3N_DRIVER_DISABLE_DEFAULT_LOCATION_INDICATOR';
const IOS_DISABLE_NAVIGATION_LOCATION_INDICATOR_MARKER = 'HY3N_DRIVER_DISABLE_NAVIGATION_LOCATION_INDICATOR';

function addAndroidNavigationApiKey(config, androidApiKey) {
  return withAndroidManifest(config, (androidConfig) => {
    if (!androidApiKey) return androidConfig;

    const application = AndroidConfig.Manifest.getMainApplication(androidConfig.modResults);
    application['meta-data'] = application['meta-data'] || [];
    const keyName = 'com.google.android.geo.API_KEY';
    const existing = application['meta-data'].find((entry) => entry.$?.['android:name'] === keyName);
    const value = { 'android:name': keyName, 'android:value': androidApiKey };

    if (existing) {
      existing.$ = value;
    } else {
      application['meta-data'].push({ $: value });
    }
    return androidConfig;
  });
}

function enableAndroidNavigationBuildSupport(config) {
  config = withGradleProperties(config, (gradleConfig) => {
    const property = gradleConfig.modResults.find((entry) => entry.type === 'property' && entry.key === 'android.enableJetifier');
    if (property) {
      property.value = 'true';
    } else {
      gradleConfig.modResults.push({ type: 'property', key: 'android.enableJetifier', value: 'true' });
    }
    return gradleConfig;
  });

  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    if (!contents.includes('coreLibraryDesugaringEnabled true')) {
      const androidClosingMarker = '\n}\n\n// Apply static values';
      if (!contents.includes(androidClosingMarker)) {
        throw new Error('Unable to configure Android core library desugaring for Google Navigation.');
      }
      const insertion = `\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n        sourceCompatibility JavaVersion.VERSION_1_8\n        targetCompatibility JavaVersion.VERSION_1_8\n    }\n}`;
      contents = contents.replace(androidClosingMarker, `${insertion}\n\n// Apply static values`);
    }

    if (!contents.includes('desugar_jdk_libs_nio:2.0.4')) {
      contents = contents.replace(/dependencies\s*\{/, (section) => `${section}\n    ${DESUGARING_DEPENDENCY}`);
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

function addIosNavigationApiKey(config, iosApiKey) {
  return withAppDelegate(config, (iosConfig) => {
    if (!iosApiKey) return iosConfig;
    if (iosConfig.modResults.language !== 'swift') {
      throw new Error('HY3N Driver expects a Swift AppDelegate for Google Navigation configuration.');
    }

    let contents = iosConfig.modResults.contents;
    if (!contents.includes('import GoogleMaps')) {
      contents = contents.replace('import Expo\n', 'import Expo\nimport GoogleMaps\n');
    }

    const apiKeyLine = `GMSServices.provideAPIKey("${iosApiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
    if (!contents.includes('GMSServices.provideAPIKey(')) {
      const returnStatement = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
      if (!contents.includes(returnStatement)) {
        throw new Error('Unable to configure the iOS Google Navigation API key in AppDelegate.');
      }
      contents = contents.replace(returnStatement, `    ${apiKeyLine}\n    ${returnStatement}`);
    }

    iosConfig.modResults.contents = contents;
    return iosConfig;
  });
}

/**
 * NavigationView exposes Google Maps' native marker controller. Its custom
 * image contract uses Android app assets and iOS asset-catalog names rather
 * than Metro's runtime image URI. Copy the existing HY3N vehicle marker to
 * both native locations whenever Expo generates a fresh native project.
 */
function addDriverCarMarkerAssets(config) {
  config = withDangerousMod(config, ['android', async (androidConfig) => {
    const source = path.join(androidConfig.modRequest.projectRoot, DRIVER_CAR_MARKER_SOURCE);
    const destination = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app',
      'src',
      'main',
      'assets',
      ANDROID_DRIVER_CAR_MARKER,
    );
    if (!fs.existsSync(source)) {
      throw new Error(`HY3N Driver vehicle marker is missing: ${source}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return androidConfig;
  }]);

  return withDangerousMod(config, ['ios', async (iosConfig) => {
    const source = path.join(iosConfig.modRequest.projectRoot, DRIVER_CAR_MARKER_SOURCE);
    const assetCatalog = path.join(
      iosConfig.modRequest.platformProjectRoot,
      iosConfig.modRequest.projectName,
      'Images.xcassets',
    );
    const imageSet = path.join(assetCatalog, `${IOS_DRIVER_CAR_MARKER}.imageset`);
    if (!fs.existsSync(source)) {
      throw new Error(`HY3N Driver vehicle marker is missing: ${source}`);
    }
    fs.mkdirSync(imageSet, { recursive: true });
    fs.copyFileSync(source, path.join(imageSet, `${IOS_DRIVER_CAR_MARKER}.png`));
    fs.writeFileSync(path.join(imageSet, 'Contents.json'), JSON.stringify({
      images: [{ filename: `${IOS_DRIVER_CAR_MARKER}.png`, idiom: 'universal', scale: '1x' }],
      info: { author: 'xcode', version: 1 },
    }, null, 2));
    return iosConfig;
  }]);
}

/**
 * Navigation SDK creates its iOS GMSMapView before React props are applied and
 * can re-enable its current-location indicator when a navigation session is
 * attached. Apply the native value at both lifecycle points so the branded
 * HY3N Driver car is the sole live-vehicle marker.
 */
function disableIosDefaultLocationIndicator(config) {
  return withDangerousMod(config, ['ios', async (iosConfig) => {
    const source = path.join(
      iosConfig.modRequest.projectRoot,
      IOS_NAVIGATION_VIEW_CONTROLLER_SOURCE,
    );
    if (!fs.existsSync(source)) {
      throw new Error(`Google Navigation iOS source is missing: ${source}`);
    }

    let contents = fs.readFileSync(source, 'utf8');
    if (!contents.includes(IOS_DISABLE_DEFAULT_LOCATION_INDICATOR_MARKER)) {
      const creationLine = '  _mapView = [[GMSMapView alloc] initWithOptions:options];\n';
      if (!contents.includes(creationLine)) {
        throw new Error('Unable to disable the iOS Navigation SDK location indicator.');
      }
      const replacement = `${creationLine}  // ${IOS_DISABLE_DEFAULT_LOCATION_INDICATOR_MARKER}\n  // HY3N renders its own live, heading-aware vehicle marker instead.\n  _mapView.myLocationEnabled = NO;\n`;
      contents = contents.replace(creationLine, replacement);
    }

    if (!contents.includes(IOS_DISABLE_NAVIGATION_LOCATION_INDICATOR_MARKER)) {
      const attachmentLine = '  if (result) {\n    _isSessionAttached = YES;\n';
      if (!contents.includes(attachmentLine)) {
        throw new Error('Unable to suppress the iOS Navigation SDK location indicator after session attachment.');
      }
      const replacement = `  if (result) {\n    // ${IOS_DISABLE_NAVIGATION_LOCATION_INDICATOR_MARKER}\n    // Navigation SDK can restore the blue current-location arrow while attaching.\n    // Keep the native location service active for guidance but hide its visual indicator.\n    _mapView.myLocationEnabled = NO;\n    _isSessionAttached = YES;\n`;
      contents = contents.replace(attachmentLine, replacement);
    }

    fs.writeFileSync(source, contents);
    return iosConfig;
  }]);
}

function withGoogleNavigation(config, options = {}) {
  config = addDriverCarMarkerAssets(config);
  config = addAndroidNavigationApiKey(config, String(options.androidApiKey || '').trim());
  config = enableAndroidNavigationBuildSupport(config);
  config = addIosNavigationApiKey(config, String(options.iosApiKey || '').trim());
  config = disableIosDefaultLocationIndicator(config);
  return config;
}

module.exports = createRunOncePlugin(withGoogleNavigation, PLUGIN_NAME, '1.2.0');
