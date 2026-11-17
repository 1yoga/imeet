export const colors = {
  backgroundTop: '#07051E',
  backgroundBottom: '#070520',
  white: '#FFFFFF',
  subtitle: '#BEBEBE',
  primary: '#4132F1',
  buttonHighlight: '#D3CEFF',
  infoBackground: 'rgba(183, 158, 255, 0.24)',
  glassBackground: 'rgba(12, 10, 24, 0.82)',
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
  infoTop: 562,
  actionsTop: 632,
  tabBarBottom: 24,
} as const;

export const typography = {
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '400' as const,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  button: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  info: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '400' as const,
  },
  tab: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '400' as const,
  },
} as const;
