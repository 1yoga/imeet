import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

/** Поле ввода диалогов: подпись сверху, при фокусе — фиолетовая рамка. */
export function TextField({ label, value, onChange, placeholder = 'Ввести текст', onSubmit, autoFocus }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoFocus={autoFocus}
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor="rgba(255, 255, 255, 0.45)"
        returnKeyType="done"
        selectionColor="#8B7CFF"
        style={[styles.input, focused && styles.focused]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  label: { ...typography.info, color: colors.white, fontSize: 13 },
  input: {
    ...typography.subtitle,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    color: colors.white,
    height: 42,
    paddingHorizontal: 16,
  },
  focused: { borderColor: '#8B7CFF' },
});
