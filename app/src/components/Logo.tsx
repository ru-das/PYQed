import React from 'react';
import { Image } from 'react-native';

/** App logo. */
export function Logo({ size = 96 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="PYQed logo"
    />
  );
}
