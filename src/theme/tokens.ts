import { fontFamilies } from '@/theme/fonts';

export const colors = {
  backgroundTop: '#07051E',
  backgroundBottom: '#070520',
  white: '#FFFFFF',
  subtitle: '#BEBEBE',
  primary: '#4132F1',
  buttonHighlight: '#D3CEFF',
  infoBackground: 'rgba(183, 158, 255, 0.24)',
  glassBackground: 'transparent',
  glassFallbackTop: 'rgba(66, 57, 102, 0.42)',
  glassFallbackBottom: 'rgba(11, 9, 25, 0.86)',
  glassBorder: 'rgba(255, 255, 255, 0.24)',
} as const;

export const layout = {
  frameWidth: 412,
  frameHeight: 852,
  horizontalPadding: 16,
  contentWidth: 380,
  waveWidth: 605,
  waveHeight: 222,
  waveLeft: -103,
  waveTop: 294,
  titleTop: 70,
  infoTop: 562,
  actionsTop: 632,
  tabBarBottom: 24,
} as const;

export const typography = {
  title: {
    fontFamily: fontFamilies.title,
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    fontFamily: fontFamilies.body,
    fontSize: 16,
    lineHeight: 22,
  },
  button: {
    fontFamily: fontFamilies.control,
    fontSize: 14,
    lineHeight: 18,
  },
  info: {
    fontFamily: fontFamilies.body,
    fontSize: 14,
    lineHeight: 17,
  },
  tab: {
    fontFamily: fontFamilies.controlRegular,
    fontSize: 10,
    lineHeight: 12,
  },
  heading: {
    fontFamily: fontFamilies.heading,
    fontSize: 18,
    lineHeight: 22,
  },
  tag: {
    fontFamily: fontFamilies.tag,
    fontSize: 12,
    lineHeight: 15,
  },
} as const;
