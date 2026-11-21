import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type ChatMessage, timeLabel } from '@/features/chat/chatStore';
import { typography } from '@/theme/tokens';

const statusIcons = {
  sent: require('../../../assets/icons/ui/check.svg'),
  read: require('../../../assets/icons/ui/check-double.svg'),
  alert: require('../../../assets/icons/ui/alert.svg'),
};

/** Пузырь сообщения по компоненту Message из Figma (141:1992): текст или фото, время и статус. */
export function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const { mine, status } = message;
  const sending = mine && status === 'sending';
  const photo = Boolean(message.photoUri);

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {mine && status === 'error' && (
        <Pressable accessibilityLabel="Не отправлено. Повторить" hitSlop={8} onPress={onRetry}>
          <Image contentFit="contain" source={statusIcons.alert} style={styles.alert} />
        </Pressable>
      )}
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs, sending && styles.sending, photo && styles.photoBubble]}>
        {photo && <Image contentFit="cover" source={{ uri: message.photoUri }} style={styles.photo} transition={150} />}
        {message.text ? (
          <Text style={[styles.text, sending && styles.textSending, photo && styles.caption]}>{message.text}</Text>
        ) : null}
        {/* В макете у отправляемого (фиолетового) сообщения времени нет. */}
        {!sending && (
          <View style={[styles.meta, photo && styles.metaPhoto]}>
            <Text style={styles.time}>{timeLabel(message.sentAt)}</Text>
            {mine && (status === 'sent' || status === 'read') && (
              <Image contentFit="contain" source={status === 'read' ? statusIcons.read : statusIcons.sent} style={styles.check} />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  alert: { height: 20, width: 20 },
  bubble: {
    alignItems: 'flex-end',
    borderRadius: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  mine: { backgroundColor: '#B4C7FB' },
  theirs: { backgroundColor: '#E3E8F0' },
  sending: { backgroundColor: '#8B7CFF' },
  photoBubble: { borderRadius: 24, flexDirection: 'column', padding: 8 },
  photo: { borderRadius: 18, height: 220, width: 220 },
  text: { ...typography.subtitle, color: '#1C1C1E', flexShrink: 1, fontSize: 16 },
  textSending: { color: '#FFFFFF' },
  caption: { alignSelf: 'flex-start', paddingHorizontal: 6 },
  meta: { alignItems: 'center', flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  metaPhoto: { paddingHorizontal: 6 },
  time: { ...typography.info, color: '#5A6B8C', fontSize: 12 },
  check: { height: 16, width: 16 },
});
