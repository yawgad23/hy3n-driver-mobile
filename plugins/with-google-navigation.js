const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withGradleProperties,
} = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-google-navigation';
const DESUGARING_DEPENDENCY = "coreLibraryDesugaring('com.android.tools:desugar_jdk_libs_nio:2.0.4')";

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

function withGoogleNavigation(config, options = {}) {
  config = addAndroidNavigationApiKey(config, String(options.androidApiKey || '').trim());
  config = enableAndroidNavigationBuildSupport(config);
  config = addIosNavigationApiKey(config, String(options.iosApiKey || '').trim());
  return config;
}

module.exports = createRunOncePlugin(withGoogleNavigation, PLUGIN_NAME, '1.0.0');
