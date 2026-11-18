export type ConversationStatus =
  | 'idle'
  | 'preparing'
  | 'listening'
  | 'user-speaking'
  | 'recognizing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type NavigationTab = 'notifications' | 'matches' | 'profile';
