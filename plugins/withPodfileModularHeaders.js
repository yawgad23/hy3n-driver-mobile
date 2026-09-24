/**
 * The Driver app combines native Firebase phone authentication with native
 * Google Maps. Firebase must use CocoaPods static frameworks because Google
 * Maps includes static XCFrameworks. Under Expo SDK 54 / React Native 0.81,
 * the framework pod targets import React headers, which Xcode otherwise
 * treats as a non-modular include error. Apply the documented allowance only
 * to the Firebase and react-native-maps pod targets.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STATIC_MARKER = '# @generated begin rnfirebase-static-framework-fix';
const HEADER_MARKER = '# @generated begin native-framework-header-compatibility';

module.exports = function withPodfileModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf-8');

      if (!contents.includes(STATIC_MARKER)) {
        const staticSnippet = `${STATIC_MARKER}\n$RNFirebaseAsStaticFramework = true\n# @generated end rnfirebase-static-framework-fix\n\n`;
        const targetRegex = /(target ['"])/;
        if (targetRegex.test(contents)) {
          contents = contents.replace(targetRegex, `${staticSnippet}$1`);
        } else {
          contents = staticSnippet + contents;
        }
      }

      if (!contents.includes(HEADER_MARKER)) {
        const headerSnippet = `  ${HEADER_MARKER}\n  installer.pods_project.targets.each do |target|\n    if target.name.start_with?('RNFB') || ['react-native-maps', 'react-native-google-maps'].include?(target.name)\n      target.build_configurations.each do |build_configuration|\n        build_configuration.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'\n      end\n    end\n  end\n  # @generated end native-framework-header-compatibility\n\n`;
        const postInstallRegex = /(post_install do \|installer\|\n)/;
        if (!postInstallRegex.test(contents)) {
          throw new Error('Could not find the generated Podfile post_install block.');
        }
        contents = contents.replace(postInstallRegex, `$1${headerSnippet}`);
      }

      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};
