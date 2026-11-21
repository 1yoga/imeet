import { create } from 'zustand';

import type { NavigationTab } from '@/features/conversation/types';

interface AppState {
  activeTab: NavigationTab;
  isInfoVisible: boolean;
  setActiveTab: (tab: NavigationTab) => void;
  dismissInfo: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'notifications',
  isInfoVisible: true,
  setActiveTab: (activeTab) => set({ activeTab }),
  dismissInfo: () => set({ isInfoVisible: false }),
}));
