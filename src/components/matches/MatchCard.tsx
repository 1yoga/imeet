import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/components/ai-conversation/GlassSurface';
import { uiIcons } from '@/components/candidate/icons';
import { CardPhotos } from '@/components/matches/CardPhotos';
import { ageLabel, candidates } from '@/features/matches/candidates';
import { useMatchesStore } from '@/features/matches/matchesStore';
import { gilroy } from '@/theme/fonts';
import { colors, typography } from '@/theme/tokens';

interface MatchCardProps {
  top: number;
  bottom: number;
  width: number;
}

type Verdict = 'like' | 'skip';

/**
 * Вкладка «Карточки симпатий»: стеклянная карточка кандидата (Figma 56:290).
 * Свайп вправо — симпатия, влево — пропустить (то же, что кнопки звезды и крестика):
 * карточка наклоняется за пальцем, проявляется метка решения, после броска улетает,
 * а следующая проявляется на её месте.
 */
export function MatchCard({ top, bottom, width }: MatchCardProps) {
  const index = useMatchesStore((state) => state.index);
  const decide = useMatchesStore((state) => state.decide);
  const restart = useMatchesStore((state) => state.restart);
  const [stripHeight, setStripHeight] = useState(0);
  const candidate = candidates[index];

  const dx = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);
  const current = useRef(candidate);
  current.current = candidate;
  const flyDistance = (width + 32) * 1.4;

  const flyOut = (verdict: Verdict) => {
    const target = current.current;
    if (!target || busy.current) return;
    busy.current = true;
    Animated.timing(dx, {
      duration: 240,
      easing: Easing.in(Easing.quad),
      toValue: verdict === 'like' ? flyDistance : -flyDistance,
      useNativeDriver: true,
    }).start(() => {
      // Сначала прячем карточку, потом возвращаем в центр и меняем кандидата — без вспышки старой.
      enter.setValue(0);
      dx.setValue(0);
      decide(target.id, verdict);
      Animated.timing(enter, { duration: 280, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true })
        .start(() => { busy.current = false; });
    });
  };
  const flyOutRef = useRef(flyOut);
  flyOutRef.current = flyOut;

  const pan = useMemo(() => {
    const back = () => Animated.spring(dx, { friction: 6, tension: 60, toValue: 0, useNativeDriver: true }).start();
    return PanResponder.create({
      // Перехватываем только явно горизонтальный жест: вертикальная прокрутка и тапы остаются карточке.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !busy.current && Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_, g) => dx.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const far = Math.abs(g.dx) > width * 0.3;
        const flung = Math.abs(g.vx) > 0.7 && Math.abs(g.dx) > 40;
        if (far || flung) flyOutRef.current(g.dx > 0 ? 'like' : 'skip');
        else back();
      },
      onPanResponderTerminate: back,
      onPanResponderTerminationRequest: () => false,
    });
  }, [dx, width]);

  if (!candidate) {
    return (
      <View style={[styles.empty, { top, width }]}>
        <Text style={styles.emptyTitle}>Карточки закончились</Text>
        <Text style={styles.emptyText}>Агент подберёт новых людей, когда узнает вас получше.</Text>
        <Pressable accessibilityRole="button" onPress={restart} style={styles.emptyButton}>
          <Text style={styles.emptyButtonText}>Показать снова</Text>
        </Pressable>
      </View>
    );
  }

  const openProfile = () => router.push({ pathname: '/candidate/[id]', params: { id: candidate.id } });
  const openPhoto = (photo: number) =>
    router.push({ pathname: '/photos/[id]', params: { id: candidate.id, index: String(photo) } });

  const rotate = dx.interpolate({ inputRange: [-width, 0, width], outputRange: ['-9deg', '0deg', '9deg'] });
  const likeOpacity = dx.interpolate({ extrapolate: 'clamp', inputRange: [20, width * 0.28], outputRange: [0, 1] });
  const skipOpacity = dx.interpolate({ extrapolate: 'clamp', inputRange: [-width * 0.28, -20], outputRange: [1, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.card,
        { bottom, top, width },
        { opacity: enter, transform: [{ translateX: dx }, { rotate }, { scale }] },
      ]}
    >
      <GlassSurface style={styles.glass} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" onPress={openProfile} style={styles.header}>
          <Image contentFit="cover" source={candidate.avatar} style={styles.avatar} />
          <View style={styles.headerText}>
            <Text style={styles.name}>{candidate.name}, {ageLabel(candidate.age)}</Text>
            <Text style={styles.city}>Город: {candidate.city}</Text>
          </View>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.heading}>Характеристика:</Text>
          <Text style={styles.body}>{candidate.about}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Интересы:</Text>
          <Text style={styles.body}>{candidate.interestsText}</Text>
        </View>

        <View onLayout={(event) => setStripHeight(event.nativeEvent.layout.height)} style={styles.stripSlot}>
          {stripHeight > 0 && (
            <CardPhotos
              key={candidate.id}
              height={Math.max(160, stripHeight - 17)}
              onOpen={openPhoto}
              photos={candidate.photos}
              width={width - 32}
            />
          )}
        </View>

        <View style={styles.verdicts}>
          <Pressable
            accessibilityLabel="Пропустить"
            accessibilityRole="button"
            onPress={() => flyOut('skip')}
            style={({ pressed }) => [styles.verdict, styles.skip, pressed && styles.pressed]}
          >
            <Image contentFit="contain" source={uiIcons.close} style={styles.verdictIcon} />
          </Pressable>
          <Pressable
            accessibilityLabel="Симпатия"
            accessibilityRole="button"
            onPress={() => flyOut('like')}
            style={({ pressed }) => [styles.verdict, styles.like, pressed && styles.pressed]}
          >
            <Image contentFit="contain" source={uiIcons.likeStar} style={styles.likeIcon} />
          </Pressable>
        </View>

        <View style={styles.ask}>
          <Image contentFit="contain" source={uiIcons.sparkles} style={styles.askIcon} />
          <Text numberOfLines={2} style={styles.askText}>Уточнить у {candidate.nameGenitive} для вас что-то?</Text>
          <Pressable accessibilityRole="button" onPress={openProfile} style={styles.askButton}>
            <LinearGradient
              colors={[colors.buttonHighlight, colors.primary]}
              end={{ x: 1, y: 0.5 }}
              start={{ x: 0, y: 0.5 }}
              style={styles.askGradient}
            >
              <Text style={styles.askButtonText}>Уточнить</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>

      <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLike, { opacity: likeOpacity }]}>
        <Text style={[styles.stampText, styles.stampLikeText]}>НРАВИТСЯ</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampSkip, { opacity: skipOpacity }]}>
        <Text style={[styles.stampText, styles.stampSkipText]}>ПРОПУСТИТЬ</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: colors.glassBorder,
    borderRadius: 36,
    borderWidth: 1,
    left: 16,
    overflow: 'hidden',
    position: 'absolute',
  },
  glass: { borderRadius: 36 },
  content: { flexGrow: 1, gap: 14, paddingBottom: 16, paddingTop: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 16, paddingHorizontal: 16 },
  avatar: { borderRadius: 35, height: 70, width: 70 },
  headerText: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.white, fontSize: 20, lineHeight: 25 },
  city: { ...typography.subtitle, color: colors.subtitle, fontSize: 17 },
  section: { gap: 2, paddingHorizontal: 16 },
  heading: { ...typography.heading, color: colors.white, fontSize: 16, lineHeight: 20 },
  body: { ...typography.subtitle, color: 'rgba(255, 255, 255, 0.88)', fontSize: 14.5, lineHeight: 19 },
  stripSlot: { flexGrow: 1, minHeight: 177 },
  verdicts: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  verdict: { alignItems: 'center', borderRadius: 23, flex: 1, height: 46, justifyContent: 'center' },
  skip: { backgroundColor: 'rgba(255, 255, 255, 0.07)' },
  like: { backgroundColor: 'rgba(120, 18, 70, 0.45)' },
  pressed: { opacity: 0.7 },
  verdictIcon: { height: 26, width: 26, opacity: 0.85 },
  likeIcon: { height: 30, width: 30 },
  ask: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 23,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    minHeight: 46,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  askIcon: { height: 20, width: 20 },
  askText: { ...typography.info, color: colors.white, flex: 1, fontSize: 13 },
  askButton: { borderRadius: 17, overflow: 'hidden' },
  askGradient: { height: 34, justifyContent: 'center', paddingHorizontal: 16 },
  askButtonText: { ...typography.button, color: colors.white },
  stamp: {
    borderRadius: 12,
    borderWidth: 2.5,
    paddingHorizontal: 12,
    paddingVertical: 4,
    position: 'absolute',
    top: 22,
  },
  stampLike: { backgroundColor: 'rgba(255, 35, 105, 0.14)', borderColor: '#FF4D8D', left: 18, transform: [{ rotate: '-12deg' }] },
  stampSkip: { backgroundColor: 'rgba(190, 190, 190, 0.12)', borderColor: '#D6D6D6', right: 18, transform: [{ rotate: '12deg' }] },
  stampText: { ...typography.title, fontFamily: gilroy('bold'), fontSize: 22, letterSpacing: 1.5, lineHeight: 28 },
  stampLikeText: { color: '#FF4D8D' },
  stampSkipText: { color: '#E6E6E6' },
  empty: { alignItems: 'flex-start', gap: 10, left: 16, position: 'absolute' },
  emptyTitle: { ...typography.title, color: colors.white },
  emptyText: { ...typography.subtitle, color: colors.subtitle },
  emptyButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyButtonText: { ...typography.button, color: colors.white },
});
