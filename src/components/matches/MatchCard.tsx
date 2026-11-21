import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/components/ai-conversation/GlassSurface';
import { uiIcons } from '@/components/candidate/icons';
import { PhotoStrip } from '@/components/candidate/PhotoStrip';
import { ageLabel, candidates } from '@/features/matches/candidates';
import { useMatchesStore } from '@/features/matches/matchesStore';
import { colors, typography } from '@/theme/tokens';

interface MatchCardProps {
  top: number;
  bottom: number;
  width: number;
}

/** Вкладка «Карточки симпатий»: стеклянная карточка кандидата (Figma 56:290). */
export function MatchCard({ top, bottom, width }: MatchCardProps) {
  const index = useMatchesStore((state) => state.index);
  const decide = useMatchesStore((state) => state.decide);
  const restart = useMatchesStore((state) => state.restart);
  const [stripHeight, setStripHeight] = useState(0);
  const candidate = candidates[index];

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
  // Первое фото в ленте занимает ~2/3 ширины, следующее выглядывает справа — подсказка, что лента листается.
  const photoWidth = Math.round((width - 32) * 0.72);

  return (
    <View style={[styles.card, { bottom, top, width }]}>
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
            <PhotoStrip
              height={Math.max(160, stripHeight - 17)}
              inset={16}
              onOpen={openPhoto}
              photoWidth={photoWidth}
              photos={candidate.photos}
            />
          )}
        </View>

        <View style={styles.verdicts}>
          <Pressable
            accessibilityLabel="Пропустить"
            accessibilityRole="button"
            onPress={() => decide(candidate.id, 'skip')}
            style={({ pressed }) => [styles.verdict, styles.skip, pressed && styles.pressed]}
          >
            <Image contentFit="contain" source={uiIcons.close} style={styles.verdictIcon} />
          </Pressable>
          <Pressable
            accessibilityLabel="Симпатия"
            accessibilityRole="button"
            onPress={() => decide(candidate.id, 'like')}
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
    </View>
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
  name: { ...typography.title, color: colors.white, fontSize: 20, fontWeight: '600', lineHeight: 25 },
  city: { ...typography.subtitle, color: colors.subtitle, fontSize: 17 },
  section: { gap: 2, paddingHorizontal: 16 },
  heading: { ...typography.subtitle, color: colors.white, fontSize: 16, fontWeight: '600' },
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
