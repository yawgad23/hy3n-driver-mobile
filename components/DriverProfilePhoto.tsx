import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const GOLD = '#D4AF37';

type DriverProfilePhotoProps = {
  uri?: string;
  identity: string;
  driverName: string;
};

/** A changed account or photo gets fresh loading/error state immediately. */
export function DriverProfilePhoto({ uri, identity, driverName }: DriverProfilePhotoProps) {
  return <ProfilePhotoImage key={`${identity}:${uri ?? ''}`} uri={uri} driverName={driverName} />;
}

function ProfilePhotoImage({ uri, driverName }: Omit<DriverProfilePhotoProps, 'identity'>) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(uri) && !failed;
  return (
    <View
      testID="driver-profile-photo"
      accessible
      accessibilityRole="image"
      accessibilityLabel={showPhoto ? `Driver profile photo for ${driverName}` : 'Driver profile photo unavailable'}
      style={styles.avatar}
    >
      {showPhoto ? (
        <Image
          testID="driver-profile-selfie"
          source={{ uri }}
          resizeMode="cover"
          style={styles.photo}
          onError={() => setFailed(true)}
        />
      ) : (
        <MaterialIcons testID="driver-profile-photo-fallback" name="person" size={44} color={GOLD} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 82, height: 82, borderRadius: 22, padding: 2,
    backgroundColor: '#1A1200', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: GOLD + '40', overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%', borderRadius: 18 },
});
