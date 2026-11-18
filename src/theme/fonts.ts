import * as Font from 'expo-font';
import { Platform } from 'react-native';

/**
 * The Figma file uses Gilroy, Manrope and SF Pro. No licensed font binaries
 * are present in the repository, so native system families are used until the
 * product supplies those files.
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

/**
 * Deliberately empty until licensed files are provided by the product team.
 * Keep this map as the single integration point for expo-font.
 */
const licensedFontSources = {};

export const requiredLicensedFonts = [
  'Gilroy-Medium.ttf',
  'Manrope-Medium.ttf',
  'Manrope-SemiBold.ttf',
  'SFProText-Semibold.ttf',
] as const;

export async function loadLicensedFonts(): Promise<void> {
  if (Object.keys(licensedFontSources).length > 0) {
    await Font.loadAsync(licensedFontSources);
  }
}
