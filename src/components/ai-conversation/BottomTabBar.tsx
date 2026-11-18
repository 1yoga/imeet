import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/components/ai-conversation/GlassSurface';
import type { NavigationTab } from '@/features/conversation/types';
import { colors, typography } from '@/theme/tokens';

interface BottomTabBarProps {
  activeTab: NavigationTab;
  bottomInset: number;
  onTabChange: (tab: NavigationTab) => void;
  scale: number;
  width: number;
}

const tabs: Array<{
  key: NavigationTab;
  label: string;
  source: number;
}> = [
  {
    key: 'notifications',
    label: 'Уведомления',
    source: require('../../../assets/figma/notifications.svg'),
  },
  {
    key: 'matches',
    label: 'Карточки симпатий',
    source: require('../../../assets/figma/card.svg'),
  },
  {
    key: 'profile',
    label: 'Профиль',
    source: require('../../../assets/figma/user-avatar.svg'),
  },
];

export function BottomTabBar({
  activeTab,
  bottomInset,
  onTabChange,
  scale,
  width,
}: BottomTabBarProps) {
  const tabWidth = Math.min(102 * scale, width / 3);

  return (
    <View style={[styles.container, { bottom: bottomInset, width }]}>
      <View style={[styles.glassBar, { borderRadius: 28 * scale, height: 52 * scale }]}>
        <GlassSurface style={[styles.glassEffect, { borderRadius: 28 * scale }]} />
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[styles.tab, { height: 48 * scale, width: tabWidth }]}
            >
              {isActive && (
                <LinearGradient
                  colors={[colors.buttonHighlight, colors.primary]}
                  end={{ x: 1, y: 0.5 }}
                  start={{ x: 0, y: 0.5 }}
                  style={[styles.selection, { borderRadius: 100 * scale }]}
                />
              )}
              <Image
                contentFit="contain"
                source={tab.source}
                style={[styles.icon, { height: 18 * scale, width: 18 * scale }]}
              />
              <Text
                style={[
                  styles.label,
                  { fontSize: Math.max(9, 10 * scale), width: tabWidth },
                  isActive && styles.activeLabel,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    left: 16,
    height: 84,
    paddingTop: 12,
    position: 'absolute',
  },
  glassBar: {
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: 2,
  },
  glassEffect: {
    borderRadius: 28,
  },
  tab: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  selection: {
    borderRadius: 100,
    bottom: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 2,
  },
  icon: {
    zIndex: 1,
  },
  label: {
    color: colors.subtitle,
    flexShrink: 1,
    fontFamily: typography.tab.fontFamily,
    fontSize: typography.tab.fontSize,
    fontWeight: typography.tab.fontWeight,
    lineHeight: typography.tab.lineHeight,
    textAlign: 'center',
    zIndex: 1,
  },
  activeLabel: {
    color: colors.white,
  },
});
