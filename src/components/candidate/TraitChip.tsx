import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { type Trait, traitIcons } from '@/features/matches/candidates';
import { colors, typography } from '@/theme/tokens';

export function TraitChip({ trait }: { trait: Trait }) {
  return (
    <View style={styles.chip}>
      <Image contentFit="contain" source={traitIcons[trait.icon]} style={styles.icon} />
      <Text style={styles.label}>{trait.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 24,
    paddingHorizontal: 9,
  },
  icon: { height: 14, width: 14 },
  label: {
    color: colors.white,
    fontFamily: typography.info.fontFamily,
    fontSize: 12.5,
    lineHeight: 16,
  },
});
