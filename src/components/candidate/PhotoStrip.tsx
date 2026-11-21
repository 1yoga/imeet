import { Image } from 'expo-image';
import { useState } from 'react';
import {
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

interface PhotoStripProps {
  photos: ImageSourcePropType[];
  photoWidth: number;
  height: number;
  /** Отступ ленты слева/справа: совпадает с полями экрана. */
  inset: number;
  gap?: number;
  radius?: number;
  onOpen?: (index: number) => void;
}

/** Лента фото с прокруткой «по одному» и точками под ней, как в макете. */
export function PhotoStrip({ photos, photoWidth, height, inset, gap = 8, radius = 24, onOpen }: PhotoStripProps) {
  const [active, setActive] = useState(0);
  const step = photoWidth + gap;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / step);
    setActive(Math.max(0, Math.min(photos.length - 1, index)));
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{ gap, paddingHorizontal: inset }}
        decelerationRate="fast"
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
      >
        {photos.map((source, index) => (
          <Pressable
            accessibilityLabel={`Фото ${index + 1} из ${photos.length}`}
            accessibilityRole="imagebutton"
            disabled={!onOpen}
            key={index}
            onPress={() => onOpen?.(index)}
          >
            <Image
              contentFit="cover"
              source={source}
              style={{ borderRadius: radius, height, width: photoWidth }}
              transition={150}
            />
          </Pressable>
        ))}
      </ScrollView>
      {photos.length > 1 && <PageDots count={photos.length} active={active} />}
    </View>
  );
}

export function PageDots({ count, active }: { count: number; active: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.dot, index === active && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  dots: { alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { backgroundColor: 'rgba(255, 255, 255, 0.35)', borderRadius: 3, height: 5, width: 5 },
  dotActive: { backgroundColor: '#FFFFFF' },
});
