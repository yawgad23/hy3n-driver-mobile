/**
 * React Native Firebase's static CocoaPods configuration needs the global
 * static-framework switch before the generated target block. The Driver app
 * uses native Google Maps, whose static XCFrameworks cannot be embedded in a
 * dynamic CocoaPods target, so Firebase's default SPM/dynamic route is not
 * compatible with this app.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# @generated begin rnfirebase-static-framework-fix';

module.exports = function withPodfileModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf-8');

      if (contents.includes(MARKER)) {
        return config;
      }

      const snippet = `${MARKER}\n$RNFirebaseAsStaticFramework = true\n# @generated end rnfirebase-static-framework-fix\n\n`;
      const targetRegex = /(target ['"])/;
      if (targetRegex.test(contents)) {
        contents = contents.replace(targetRegex, `${snippet}$1`);
      } else {
        contents = snippet + contents;
      }

      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};
