import { Platform } from 'react-native';

/**
 * В макете Figma — Gilroy, Manrope и SF Pro. Лицензионных файлов шрифтов в проекте нет,
 * поэтому пока системные семейства. Когда шрифты появятся, их подключают через expo-font
 * и меняют названия здесь.
 */
export const fontFamilies = {
  title: Platform.select({
    android: 'sans-serif',
    default: 'sans-serif',
    ios: 'System',
  }),
  body: Platform.select({
    android: 'sans-serif',
    default: 'sans-serif',
    ios: 'System',
  }),
  control: Platform.select({
    android: 'sans-serif',
    default: 'sans-serif',
    ios: 'System',
  }),
} as const;
