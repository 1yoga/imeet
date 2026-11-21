import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** Переключатели диалога «Уведомления» (Figma). */
export interface NotificationPrefs {
  enabled: boolean;
  system: boolean;
  questionsToMe: boolean;
  answersToMyQuestions: boolean;
  addedToFavorites: boolean;
}

export interface UserProfile {
  name: string;
  city: string;
  /** Локальный URI выбранного фото или null — тогда в меню кнопка загрузки. */
  avatarUri: string | null;
  notifications: NotificationPrefs;
}

const STORAGE_KEY = '@imeet/user-profile-v1';

export const defaultUserProfile: UserProfile = {
  name: 'Александр',
  city: 'Краснодар',
  avatarUri: null,
  notifications: {
    enabled: true,
    system: false,
    questionsToMe: false,
    answersToMyQuestions: false,
    addedToFavorites: false,
  },
};

interface UserProfileState extends UserProfile {
  loaded: boolean;
  load: () => Promise<void>;
  update: (changes: Partial<UserProfile>) => Promise<void>;
  setNotification: (key: keyof NotificationPrefs, value: boolean) => Promise<void>;
}

const pick = (state: UserProfile): UserProfile => ({
  name: state.name,
  city: state.city,
  avatarUri: state.avatarUri,
  notifications: state.notifications,
});

export const useUserProfile = create<UserProfileState>((set, get) => {
  const persist = () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pick(get())));
  return {
    ...defaultUserProfile,
    loaded: false,
    load: async () => {
      if (get().loaded) return;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = raw ? (JSON.parse(raw) as Partial<UserProfile>) : {};
        set({
          ...defaultUserProfile,
          ...saved,
          notifications: { ...defaultUserProfile.notifications, ...saved.notifications },
          loaded: true,
        });
      } catch {
        set({ loaded: true });
      }
    },
    update: async (changes) => {
      set(changes);
      await persist();
    },
    setNotification: async (key, value) => {
      const notifications = { ...get().notifications, [key]: value };
      // «Включить уведомления» — главный выключатель: без него остальные не действуют.
      set({ notifications });
      await persist();
    },
  };
});
