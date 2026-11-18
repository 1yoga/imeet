import {
  GlassView,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';

import { colors } from '@/theme/tokens';

interface GlassSurfaceProps {
  style?: StyleProp<ViewStyle>;
}

export function GlassSurface({ style }: GlassSurfaceProps) {
  const useNativeGlass = Platform.OS === 'ios' && isLiquidGlassAvailable();

  if (useNativeGlass) {
    return (
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, style]}
      />
    );
  }

  return (
    <LinearGradient
      colors={[colors.glassFallbackTop, colors.glassFallbackBottom]}
      end={{ x: 0.5, y: 1 }}
      pointerEvents="none"
      start={{ x: 0.5, y: 0 }}
      style={[StyleSheet.absoluteFill, style]}
    >
      <View pointerEvents="none" style={styles.topHighlight} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  topHighlight: {
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderTopWidth: 1,
    flex: 1,
  },
});
