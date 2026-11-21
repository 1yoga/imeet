import { Image } from 'expo-image';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

import { uiIcons } from './icons';

interface AskComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  busy?: boolean;
  /** Большое поле (текстовый режим) или строка «Задать вопрос» с искрами. */
  variant?: 'line' | 'box';
  autoFocus?: boolean;
}

/** Поле вопроса агенту со светящейся рамкой, как в макете. */
export function AskComposer({ value, onChange, onSend, placeholder, busy = false, variant = 'line', autoFocus }: AskComposerProps) {
  const canSend = value.trim().length > 0 && !busy;
  const box = variant === 'box';
  return (
    <View style={styles.glow}>
      <View style={[styles.field, box && styles.fieldBox]}>
        {!box && <Image contentFit="contain" source={uiIcons.sparkles} style={styles.sparkles} />}
        <TextInput
          accessibilityLabel={placeholder}
          autoFocus={autoFocus}
          editable={!busy}
          multiline={box}
          onChangeText={onChange}
          onSubmitEditing={canSend ? onSend : undefined}
          placeholder={placeholder}
          placeholderTextColor={colors.subtitle}
          returnKeyType="send"
          blurOnSubmit
          style={[styles.input, box && styles.inputBox]}
          value={value}
        />
        <Pressable
          accessibilityLabel="Отправить"
          accessibilityRole="button"
          disabled={!canSend}
          hitSlop={8}
          onPress={onSend}
          style={[styles.send, box && styles.sendBox, !canSend && styles.disabled]}
        >
          <Image contentFit="contain" source={uiIcons.arrowUp} style={styles.sendIcon} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    borderColor: 'rgba(139, 124, 255, 0.35)',
    borderRadius: 26,
    borderWidth: 3,
  },
  field: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 5, 30, 0.92)',
    borderColor: '#8B7CFF',
    borderRadius: 23,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 10,
    minHeight: 50,
    paddingLeft: 14,
    paddingRight: 6,
  },
  fieldBox: {
    alignItems: 'flex-end',
    minHeight: 80,
    paddingBottom: 8,
    paddingLeft: 14,
    paddingTop: 10,
  },
  sparkles: { height: 22, width: 22 },
  input: {
    ...typography.subtitle,
    color: colors.white,
    flex: 1,
    paddingVertical: 10,
  },
  inputBox: {
    alignSelf: 'stretch',
    paddingTop: 0,
    textAlignVertical: 'top',
  },
  send: {
    alignItems: 'center',
    backgroundColor: 'rgba(131, 112, 255, 0.4)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  sendBox: { marginBottom: 2 },
  sendIcon: { height: 14, width: 14 },
  disabled: { opacity: 0.45 },
});
