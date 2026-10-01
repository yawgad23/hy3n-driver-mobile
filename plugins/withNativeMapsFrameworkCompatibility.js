const { withPodfile } = require('@expo/config-plugins');

const MARKER = '# HY3N native-map static-framework compatibility';

/**
 * react-native-maps imports React-Core headers. This Driver target also uses
 * static Firebase frameworks, and Xcode otherwise promotes those imports to
 * non-modular-header errors. Keep this narrow: only the maps pod receives the
 * compatibility setting.
 */
module.exports = function withNativeMapsFrameworkCompatibility(config) {
  return withPodfile(config, (config) => {
    const source = config.modResults.contents;
    if (source.includes(MARKER)) return config;

    const postInstall = 'post_install do |installer|';
    if (!source.includes(postInstall)) {
      throw new Error('Unable to find the CocoaPods post_install hook for react-native-maps compatibility.');
    }

    config.modResults.contents = source.replace(
      postInstall,
      `${postInstall}
    ${MARKER}
    installer.pods_project.targets.each do |target|
      if ['react-native-maps', 'react_native_maps'].include?(target.name)
        target.build_configurations.each do |build_configuration|
          build_configuration.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        end
      end
    end`,
    );
    return config;
  });
};
