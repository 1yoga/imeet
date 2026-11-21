import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessageBubble } from '@/components/chat/MessageBubble';
import { uiIcons } from '@/components/candidate/icons';
import { useChatStore } from '@/features/chat/chatStore';
import type { Candidate } from '@/features/matches/candidates';
import { colors, typography } from '@/theme/tokens';

const photoIcon = require('../../../assets/icons/ui/image.svg');
const noMessages: never[] = [];

/** Личный чат с кандидатом. В Figma есть только пузыри сообщений — экран собран в стиле приложения. */
export function ChatScreen({ candidate }: { candidate: Candidate }) {
  const insets = useSafeAreaInsets();
  const messages = useChatStore((state) => state.threads[candidate.id] ?? noMessages);
  const send = useChatStore((state) => state.send);
  const retry = useChatStore((state) => state.retry);
  const [draft, setDraft] = useState('');

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const sendText = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(candidate.id, { text });
  };
  const sendPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) send(candidate.id, { photoUri: result.assets[0].uri });
    } catch {
      // Галерея недоступна — просто ничего не отправляем.
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.backgroundTop, colors.backgroundBottom]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable accessibilityLabel="Назад" accessibilityRole="button" hitSlop={12} onPress={back}>
          <Image contentFit="contain" source={uiIcons.arrowLeft} style={styles.backIcon} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/candidate/[id]', params: { id: candidate.id } })}
          style={styles.who}
        >
          <Image contentFit="cover" source={candidate.avatar} style={styles.avatar} />
          <View>
            <Text style={styles.name}>{candidate.name}</Text>
            <Text style={styles.city}>{candidate.city}</Text>
          </View>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <FlatList
          contentContainerStyle={styles.list}
          data={[...messages].reverse()}
          inverted
          keyExtractor={(item) => item.id}
          ListFooterComponent={messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Напишите {candidate.nameDative} первым</Text>
              <Text style={styles.emptyText}>Можно начать с того, о чём вы спрашивали агента.</Text>
            </View>
          ) : null}
          renderItem={({ item }) => <MessageBubble message={item} onRetry={() => retry(candidate.id, item.id)} />}
        />

        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable accessibilityLabel="Отправить фото" accessibilityRole="button" hitSlop={8} onPress={() => void sendPhoto()} style={styles.attach}>
            <Image contentFit="contain" source={photoIcon} style={styles.attachIcon} />
          </Pressable>
          <TextInput
            accessibilityLabel="Сообщение"
            multiline
            onChangeText={setDraft}
            placeholder="Сообщение"
            placeholderTextColor={colors.subtitle}
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityLabel="Отправить"
            accessibilityRole="button"
            disabled={!draft.trim()}
            onPress={sendText}
            style={[styles.send, !draft.trim() && styles.disabled]}
          >
            <Image contentFit="contain" source={uiIcons.arrowUp} style={styles.sendIcon} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.backgroundTop, flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backIcon: { height: 24, width: 24 },
  who: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  avatar: { borderRadius: 20, height: 40, width: 40 },
  name: { ...typography.heading, color: colors.white },
  city: { ...typography.info, color: colors.subtitle, fontSize: 13 },
  list: { gap: 10, paddingVertical: 16 },
  empty: { alignItems: 'center', gap: 6, paddingHorizontal: 32, paddingVertical: 40 },
  emptyTitle: { ...typography.title, color: colors.white, fontSize: 20, textAlign: 'center' },
  emptyText: { ...typography.subtitle, color: colors.subtitle, fontSize: 15, textAlign: 'center' },
  composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  attach: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  attachIcon: { height: 22, width: 22 },
  input: {
    ...typography.subtitle,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(139, 124, 255, 0.6)',
    borderRadius: 21,
    borderWidth: 1,
    color: colors.white,
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  send: { alignItems: 'center', backgroundColor: 'rgba(131, 112, 255, 0.4)', borderRadius: 21, height: 42, justifyContent: 'center', width: 42 },
  sendIcon: { height: 16, width: 16 },
  disabled: { opacity: 0.45 },
});
