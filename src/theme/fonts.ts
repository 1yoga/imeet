import { Platform } from 'react-native';

/**
 * Шрифты из макета Figma: Gilroy — заголовки и теги, Manrope — текст и кнопки
 * (в макете кнопки и меню на SF Pro: это шрифт Apple, на Android его заменяет Manrope).
 *
 * Файлы лежат в assets/fonts и встраиваются в сборку плагином expo-font (app.json).
 * На Android семейство = имя файла, а насыщенность выбирается файлом, поэтому
 * fontWeight вместе с этими шрифтами не задаём: иначе Android дорисует «ложный» жирный.
 */
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

const files = {
  gilroy: { regular: 'Gilroy-Regular', medium: 'Gilroy-Medium', semibold: 'Gilroy-Semibold', bold: 'Gilroy-Bold' },
  manrope: { regular: 'Manrope-Regular', medium: 'Manrope-Medium', semibold: 'Manrope-SemiBold', bold: 'Manrope-Bold' },
} as const;

const native = Platform.OS === 'android' || Platform.OS === 'ios';

export function gilroy(weight: Weight = 'regular'): string {
  return native ? files.gilroy[weight] : 'sans-serif';
}

export function manrope(weight: Weight = 'regular'): string {
  return native ? files.manrope[weight] : 'sans-serif';
}

export const fontFamilies = {
  title: gilroy('semibold'),
  heading: gilroy('semibold'),
  tag: gilroy('medium'),
  body: manrope('regular'),
  bodyMedium: manrope('medium'),
  control: manrope('semibold'),
  controlRegular: manrope('regular'),
} as const;
