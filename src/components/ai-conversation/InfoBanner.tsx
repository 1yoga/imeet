import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

interface InfoBannerProps {
  onDismiss: () => void;
}

export function InfoBanner({ onDismiss }: InfoBannerProps) {
  return (
    <View style={styles.container}>
      <Image
        contentFit="contain"
        source={require('../../../assets/figma/info.svg')}
        style={styles.infoIcon}
      />
      <Text style={styles.text}>
        Задайте вопрос голосом, или опишите текстом.
      </Text>
      <Pressable
        accessibilityLabel="Закрыть подсказку"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDismiss}
        style={styles.closeButton}
      >
        <Image
          contentFit="contain"
          source={require('../../../assets/figma/clear.svg')}
          style={styles.closeIcon}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.infoBackground,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    height: 54,
    left: 16,
    paddingHorizontal: 16,
    position: 'absolute',
    top: 562,
    width: 380,
  },
  infoIcon: {
    height: 24,
    width: 24,
  },
  text: {
    color: colors.subtitle,
    flex: 1,
    minWidth: 0,
    fontSize: typography.info.fontSize,
    fontWeight: typography.info.fontWeight,
    lineHeight: typography.info.lineHeight,
  },
  closeButton: {
    alignItems: 'center',
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  closeIcon: {
    height: 18,
    width: 18,
  },
});
