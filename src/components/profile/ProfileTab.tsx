import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/components/ai-conversation/GlassSurface';
import { useProfileDialogs } from '@/components/profile/ProfileDialogs';
import { useUserProfile } from '@/core/settings/userProfile';
import { colors, typography } from '@/theme/tokens';

const icons = {
  userEdit: require('../../../assets/icons/ui/user-edit.svg'),
  bell: require('../../../assets/icons/ui/bell.svg'),
  building: require('../../../assets/icons/ui/building.svg'),
  logout: require('../../../assets/icons/ui/logout.svg'),
  mic: require('../../../assets/icons/ui/mic.svg'),
  upload: require('../../../assets/icons/ui/upload.svg'),
  pencil: require('../../../assets/icons/ui/pencil.svg'),
};

interface ProfileTabProps {
  /** Нижняя граница меню: над панелью вкладок. */
  bottom: number;
  onVoiceSettings: () => void;
}

/** Вкладка «Профиль» (Figma 107:3160): меню профиля над панелью вкладок поверх размытого главного экрана. */
export function ProfileTab({ bottom, onVoiceSettings }: ProfileTabProps) {
  const profile = useUserProfile();
  const open = useProfileDialogs((state) => state.open);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => { void profile.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickPhoto = async () => {
    setPhotoError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) await profile.update({ avatarUri: result.assets[0].uri });
    } catch {
      setPhotoError('Не удалось открыть галерею.');
    }
  };

  const rows = [
    { icon: icons.userEdit, label: 'Изменить имя', onPress: () => open('name') },
    { icon: icons.bell, label: 'Настроить уведомления', onPress: () => open('notifications') },
    { icon: icons.building, label: 'Мой город', onPress: () => open('city') },
    // Нет в макете: настройки голоса агента и пауз, которые раньше занимали всю вкладку.
    { icon: icons.mic, label: 'Голос и паузы', onPress: onVoiceSettings },
    { icon: icons.logout, label: 'Выход', onPress: () => open('exit') },
  ];

  return (
    // Полноэкранный слой: касания не проходят к размытому главному экрану под меню.
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.menu, { bottom }]}>
        <GlassSurface style={styles.menuGlass} />
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={profile.avatarUri ? 'Сменить фото' : 'Загрузить фото'}
            accessibilityRole="button"
            onPress={() => void pickPhoto()}
            style={styles.avatar}
          >
            {profile.avatarUri ? (
              <>
                <Image contentFit="cover" source={{ uri: profile.avatarUri }} style={styles.avatarImage} />
                <View style={styles.avatarEdit}>
                  <Image contentFit="contain" source={icons.pencil} style={styles.pencil} />
                </View>
              </>
            ) : (
              <Image contentFit="contain" source={icons.upload} style={styles.uploadIcon} />
            )}
          </Pressable>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.name}>{profile.name}</Text>
            <Text numberOfLines={1} style={styles.city}>Город: {profile.city}</Text>
            {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
          </View>
        </View>
        {rows.map((row) => (
          <Pressable
            accessibilityRole="button"
            key={row.label}
            onPress={row.onPress}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowIcon}>
              <Image contentFit="contain" source={row.icon} style={styles.rowIconImage} />
            </View>
            <Text style={styles.rowLabel}>{row.label}</Text>
          </Pressable>
        ))}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    borderColor: colors.glassBorder,
    borderRadius: 30,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'absolute',
    right: 16,
    width: 310,
  },
  menuGlass: { borderRadius: 30 },
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 60,
  },
  avatarImage: { height: 60, width: 60 },
  avatarEdit: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    justifyContent: 'center',
  },
  pencil: { height: 22, width: 22 },
  uploadIcon: { height: 26, width: 26 },
  headerText: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.white, fontSize: 18, fontWeight: '600', lineHeight: 22 },
  city: { ...typography.subtitle, color: colors.subtitle, fontSize: 15 },
  error: { ...typography.info, color: '#FF8A8A', fontSize: 12 },
  row: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowPressed: { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  rowIcon: {
    alignItems: 'center',
    backgroundColor: '#7B6CFF',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowIconImage: { height: 20, width: 20 },
  rowLabel: { ...typography.subtitle, color: colors.white },
});
