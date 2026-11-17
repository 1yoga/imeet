import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NavigationTab } from '@/features/conversation/types';
import { colors, typography } from '@/theme/tokens';

interface BottomTabBarProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
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

export function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.glassBar}>
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.glassEffect]}
        />
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={styles.tab}
            >
              {isActive && (
                <LinearGradient
                  colors={[colors.buttonHighlight, colors.primary]}
                  end={{ x: 1, y: 0.5 }}
                  start={{ x: 0, y: 0.5 }}
                  style={styles.selection}
                />
              )}
              <Image
                contentFit="contain"
                source={tab.source}
                style={styles.icon}
              />
              <Text style={[styles.label, isActive && styles.activeLabel]}>
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
    bottom: 24,
    height: 84,
    left: 16,
    paddingTop: 12,
    position: 'absolute',
    width: 380,
  },
  glassBar: {
    alignItems: 'center',
    backgroundColor: colors.glassBackground,
    borderColor: colors.glassBorder,
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    height: 52,
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
    height: 48,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: 102,
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
    height: 18,
    width: 18,
    zIndex: 1,
  },
  label: {
    color: colors.subtitle,
    flexShrink: 1,
    fontSize: typography.tab.fontSize,
    fontWeight: typography.tab.fontWeight,
    lineHeight: typography.tab.lineHeight,
    textAlign: 'center',
    width: 102,
    zIndex: 1,
  },
  activeLabel: {
    color: colors.white,
  },
});
