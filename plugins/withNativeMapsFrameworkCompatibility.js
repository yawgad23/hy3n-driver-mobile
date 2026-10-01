const { withPodfile } = require('@expo/config-plugins');

const MARKER = '# HY3N native-map static-framework compatibility';

/**
 * react-native-maps imports React-Core headers. This Driver target also uses
 * static Firebase frameworks, and Xcode otherwise promotes those imports to
 * non-modular-header errors. The setting must run after Expo's React Native
 * post-install hook because that hook rebuilds the pod build settings.
 */
module.exports = function withNativeMapsFrameworkCompatibility(config) {
  return withPodfile(config, (config) => {
    const source = config.modResults.contents;
    if (source.includes(MARKER)) return config;

    const hookEnd = /\n  end\nend\s*$/;
    if (!hookEnd.test(source)) {
      throw new Error('Unable to locate the CocoaPods post_install hook ending for react-native-maps compatibility.');
    }

    const compatibility = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      if ['react-native-maps', 'react_native_maps'].include?(target.name)
        target.build_configurations.each do |build_configuration|
          build_configuration.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        end
      end
    end`;

    config.modResults.contents = source.replace(hookEnd, `${compatibility}\n  end\nend\n`);
    return config;
  });
};
