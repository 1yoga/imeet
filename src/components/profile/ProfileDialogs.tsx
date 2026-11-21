import { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';

import { DialogButton, GlassDialog } from '@/components/ui/GlassDialog';
import { TextField } from '@/components/ui/TextField';
import { ToggleRow } from '@/components/ui/Toggle';
import { type NotificationPrefs, useUserProfile } from '@/core/settings/userProfile';
import { colors, typography } from '@/theme/tokens';

type DialogKind = 'name' | 'city' | 'notifications' | 'exit';

/** Какой диалог профиля открыт. Меню только открывает, а рисует их экран — поверх размытого содержимого. */
export const useProfileDialogs = create<{ dialog: DialogKind | null; open: (kind: DialogKind) => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

const notificationRows: Array<{ key: keyof NotificationPrefs; label: string }> = [
  { key: 'enabled', label: 'Включить уведомления' },
  { key: 'system', label: 'Системные уведомления' },
  { key: 'questionsToMe', label: 'Вопросы мне' },
  { key: 'answersToMyQuestions', label: 'Ответы на мои вопросы' },
  { key: 'addedToFavorites', label: 'Меня добавили в избранное' },
];

/** Диалоги профиля (Figma): «Изменить имя», «Ваш город», «Уведомления», «Выход». */
export function ProfileDialogs() {
  const dialog = useProfileDialogs((state) => state.dialog);
  const close = useProfileDialogs((state) => state.close);
  const profile = useUserProfile();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(dialog === 'name' ? profile.name : dialog === 'city' ? profile.city : '');
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (field: 'name' | 'city') => {
    const value = draft.trim();
    if (!value) return;
    await profile.update({ [field]: value });
    close();
  }, [close, draft, profile]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GlassDialog
        actions={(
          <>
            <DialogButton kind="outline" label="Отмена" onPress={close} />
            <DialogButton disabled={!draft.trim()} label="Сохранить" onPress={() => void save('name')} />
          </>
        )}
        onClose={close}
        title="Изменить имя"
        visible={dialog === 'name'}
      >
        <TextField autoFocus label="Имя" onChange={setDraft} onSubmit={() => void save('name')} value={draft} />
      </GlassDialog>

      <GlassDialog
        actions={(
          <>
            <DialogButton kind="outline" label="Отмена" onPress={close} />
            <DialogButton disabled={!draft.trim()} label="Сохранить" onPress={() => void save('city')} />
          </>
        )}
        onClose={close}
        title="Ваш город"
        visible={dialog === 'city'}
      >
        <TextField autoFocus label="Название города" onChange={setDraft} onSubmit={() => void save('city')} value={draft} />
      </GlassDialog>

      <GlassDialog onClose={close} title="Уведомления" visible={dialog === 'notifications'}>
        <View style={styles.toggles}>
          {notificationRows.map((row, index) => (
            <ToggleRow
              disabled={row.key !== 'enabled' && !profile.notifications.enabled}
              key={row.key}
              label={row.label}
              last={index === notificationRows.length - 1}
              onChange={(value) => void profile.setNotification(row.key, value)}
              value={profile.notifications[row.key]}
            />
          ))}
        </View>
      </GlassDialog>

      <GlassDialog
        actions={(
          <>
            <DialogButton kind="outline" label="Отмена" onPress={close} />
            <DialogButton kind="danger" label="Выйти" onPress={() => { close(); BackHandler.exitApp(); }} />
          </>
        )}
        onClose={close}
        title="Выход"
        visible={dialog === 'exit'}
      >
        <Text style={styles.message}>Вы точно хотите покинуть приложение?</Text>
      </GlassDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  toggles: { paddingBottom: 12, paddingTop: 4 },
  message: { ...typography.subtitle, color: colors.white, fontSize: 15, paddingBottom: 8, paddingHorizontal: 16, paddingTop: 18 },
});
