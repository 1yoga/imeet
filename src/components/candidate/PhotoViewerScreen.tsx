import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Candidate } from '@/features/matches/candidates';

import { uiIcons } from './icons';
import { PageDots } from './PhotoStrip';

/** Фото на весь экран с пролистыванием (Figma «Фото» 104:762). */
export function PhotoViewerScreen({ candidate, initialIndex }: { candidate: Candidate; initialIndex: number }) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const start = Math.max(0, Math.min(candidate.photos.length - 1, initialIndex));
  const [active, setActive] = useState(start);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActive(Math.round(event.nativeEvent.contentOffset.x / width));
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <FlatList
        data={candidate.photos}
        getItemLayout={(_, index) => ({ index, length: width, offset: width * index })}
        horizontal
        initialScrollIndex={start}
        keyExtractor={(_, index) => String(index)}
        onMomentumScrollEnd={onScroll}
        pagingEnabled
        renderItem={({ item }) => (
          <Image contentFit="cover" source={item} style={{ height, width }} transition={150} />
        )}
        showsHorizontalScrollIndicator={false}
      />
      {/* Лёгкое затемнение сверху, чтобы стрелка читалась на светлых фото. */}
      <View pointerEvents="none" style={[styles.shade, { height: insets.top + 80 }]} />
      <Pressable
        accessibilityLabel="Назад"
        accessibilityRole="button"
        hitSlop={12}
        onPress={back}
        style={[styles.back, { top: insets.top + 24 }]}
      >
        <Image contentFit="contain" source={uiIcons.arrowLeft} style={styles.backIcon} />
      </Pressable>
      <View style={[styles.dots, { bottom: insets.bottom + 40 }]}>
        <PageDots active={active} count={candidate.photos.length} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#000000', flex: 1 },
  shade: { backgroundColor: 'rgba(0, 0, 0, 0.18)', left: 0, position: 'absolute', right: 0, top: 0 },
  back: { left: 16, position: 'absolute' },
  backIcon: { height: 26, width: 26 },
  dots: { left: 0, position: 'absolute', right: 0 },
});
