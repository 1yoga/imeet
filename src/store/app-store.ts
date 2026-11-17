import { create } from 'zustand';

import type {
  ConversationStatus,
  NavigationTab,
} from '@/features/conversation/types';

export type ServiceStatus = 'not-configured' | 'ready';

interface AppState {
  runtimeStatus: 'ready';
  asrStatus: ServiceStatus;
  vadStatus: ServiceStatus;
  ttsStatus: ServiceStatus;
  agentStatus: ServiceStatus;
  conversationStatus: ConversationStatus;
  activeTab: NavigationTab;
  isInfoVisible: boolean;
  setConversationStatus: (status: ConversationStatus) => void;
  setActiveTab: (tab: NavigationTab) => void;
  dismissInfo: () => void;
  resetConversation: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  runtimeStatus: 'ready',
  asrStatus: 'not-configured',
  vadStatus: 'not-configured',
  ttsStatus: 'not-configured',
  agentStatus: 'not-configured',
  conversationStatus: 'idle',
  activeTab: 'notifications',
  isInfoVisible: true,
  setConversationStatus: (conversationStatus) => set({ conversationStatus }),
  setActiveTab: (activeTab) => set({ activeTab }),
  dismissInfo: () => set({ isInfoVisible: false }),
  resetConversation: () =>
    set({ conversationStatus: 'idle', isInfoVisible: true }),
}));
