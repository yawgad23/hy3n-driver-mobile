const { createRunOncePlugin, withAppBuildGradle } = require('@expo/config-plugins');

const DATASTORE_VERSION = '1.2.1';
const BEGIN_MARKER = '// HY3N_ANDROID_DATASTORE_16KB_BEGIN';
const END_MARKER = '// HY3N_ANDROID_DATASTORE_16KB_END';
const CONSTRAINT_BLOCK = `${BEGIN_MARKER}
// This prebuilt native library must come from the infrastructure-patched
// AndroidX release. Changing the app NDK cannot recompile a Maven AAR.
// AndroidX atomic-group constraints align the already-used DataStore family.
dependencies {
    constraints {
        implementation('androidx.datastore:datastore-core:${DATASTORE_VERSION}') {
            because('Use the DataStore infrastructure patch with updated 16 KB native memory layout')
        }
    }
}
${END_MARKER}`;

function addDataStoreConstraint(contents, language) {
  if (language !== 'groovy') {
    throw new Error('HY3N DataStore 16 KB configuration expects a Groovy app build.gradle.');
  }
  const begins = contents.split(BEGIN_MARKER).length - 1;
  const ends = contents.split(END_MARKER).length - 1;
  if (begins || ends) {
    if (begins !== 1 || ends !== 1 || !contents.includes(CONSTRAINT_BLOCK)) {
      throw new Error('HY3N DataStore 16 KB constraint is duplicated, incomplete or changed.');
    }
    return contents;
  }
  return `${contents.trimEnd()}\n\n${CONSTRAINT_BLOCK}\n`;
}

function withAndroidDataStore16kb(config) {
  return withAppBuildGradle(config, (androidConfig) => {
    androidConfig.modResults.contents = addDataStoreConstraint(
      androidConfig.modResults.contents,
      androidConfig.modResults.language,
    );
    return androidConfig;
  });
}

module.exports = createRunOncePlugin(
  withAndroidDataStore16kb,
  'with-android-datastore-16kb',
  '1.0.0',
);
module.exports.addDataStoreConstraint = addDataStoreConstraint;
module.exports.DATASTORE_VERSION = DATASTORE_VERSION;
module.exports.CONSTRAINT_BLOCK = CONSTRAINT_BLOCK;
