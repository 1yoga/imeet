import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

interface InfoBannerProps {
  onDismiss?: () => void;
  progress?: number;
  scale: number;
  text: string;
  top: number;
  width: number;
}

export function InfoBanner({
  onDismiss,
  progress,
  scale,
  text,
  top,
  width,
}: InfoBannerProps) {
  const percent = progress === undefined ? undefined : Math.round(progress * 100);

  return (
    <View style={[styles.container, { minHeight: 54 * scale, top, width }]}>
      <Image
        contentFit="contain"
        source={require('../../../assets/figma/info.svg')}
        style={{ height: 24 * scale, width: 24 * scale }}
      />
      <View style={styles.body}>
        <Text accessibilityLiveRegion={percent === undefined ? 'polite' : 'none'} style={styles.text}>
          {text}
        </Text>
        {percent !== undefined && (
          <View
            accessibilityLabel="Подготовка модели речи"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        )}
      </View>
      {onDismiss && (
        <Pressable
          accessibilityLabel="Закрыть подсказку"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDismiss}
          style={[styles.closeButton, { height: 26 * scale, width: 26 * scale }]}
        >
          <Image
            contentFit="contain"
            source={require('../../../assets/figma/clear.svg')}
            style={{ height: 18 * scale, width: 18 * scale }}
          />
        </Pressable>
      )}
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
    left: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    position: 'absolute',
  },
  body: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  text: {
    ...typography.info,
    color: colors.subtitle,
  },
  progressTrack: {
    backgroundColor: colors.glassBorder,
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.buttonHighlight,
    height: '100%',
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
