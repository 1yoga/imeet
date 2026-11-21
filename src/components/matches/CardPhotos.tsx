import { Image } from 'expo-image';
import { useState } from 'react';
import { type GestureResponderEvent, type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { PageDots } from '@/components/candidate/PhotoStrip';

const GAP = 8;
const RADIUS = 24;
/** Доля ширины, которую занимает текущее фото; следующее — узкая целая карточка справа (макет 56:290). */
const MAIN_SHARE = 0.72;
const ease = { duration: 320, easing: Easing.out(Easing.cubic) };

interface CardPhotosProps {
  photos: ImageSourcePropType[];
  width: number;
  height: number;
  onOpen: (index: number) => void;
}

/**
 * Фото в карточке симпатии: текущее большое, следующее узкое рядом (не обрезано краем, макет 56:290).
 * Свайп влево/вправо занят решением по всей карточке, поэтому фото листаются тапами:
 * тап по узкому — следующее; тап по левому краю большого — предыдущее; тап по остальному — на весь экран.
 */
export function CardPhotos({ photos, width, height, onOpen }: CardPhotosProps) {
  const [active, setActive] = useState(0);
  const count = photos.length;
  // На последнем фото следующего нет — оно занимает всю ширину.
  const hasNext = active < count - 1;
  const mainWidth = hasNext ? Math.round((width - GAP) * MAIN_SHARE) : width;
  const sideWidth = hasNext ? width - GAP - mainWidth : 0;

  const go = (index: number) => setActive(Math.max(0, Math.min(count - 1, index)));

  const pressMain = (index: number, event: GestureResponderEvent) => {
    if (index > 0 && event.nativeEvent.locationX < mainWidth * 0.3) go(index - 1);
    else onOpen(index);
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, { height, width }]}>
        {photos.map((source, index) => {
          const role = index === active ? 'main' : index === active + 1 ? 'side' : 'hidden';
          return (
            <Slot
              height={height}
              key={index}
              onPress={(event) => (role === 'main' ? pressMain(index, event) : go(index))}
              role={role}
              source={source}
              widths={{ main: mainWidth, side: sideWidth }}
            />
          );
        })}
      </View>
      {count > 1 && <PageDots active={active} count={count} />}
    </View>
  );
}

function Slot({ source, role, widths, height, onPress }: {
  source: ImageSourcePropType;
  role: 'main' | 'side' | 'hidden';
  widths: { main: number; side: number };
  height: number;
  onPress: (event: GestureResponderEvent) => void;
}) {
  const width = role === 'main' ? widths.main : role === 'side' ? widths.side : 0;
  const style = useAnimatedStyle(() => ({
    width: withTiming(width, ease),
    marginRight: withTiming(role === 'main' && widths.side > 0 ? GAP : 0, ease),
    opacity: withTiming(role === 'hidden' ? 0 : 1, ease),
  }), [role, width, widths.side]);
  return (
    <Animated.View style={[styles.slot, { height }, style]}>
      <Pressable
        accessibilityLabel={role === 'main' ? 'Открыть фото' : 'Следующее фото'}
        accessibilityRole="imagebutton"
        disabled={role === 'hidden'}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      >
        <Image contentFit="cover" source={source} style={StyleSheet.absoluteFill} transition={150} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', gap: 12 },
  row: { flexDirection: 'row', overflow: 'hidden' },
  slot: { borderRadius: RADIUS, overflow: 'hidden' },
});
