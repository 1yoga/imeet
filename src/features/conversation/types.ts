export type ConversationStatus =
  | 'idle'
  | 'preparing'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type NavigationTab = 'notifications' | 'matches' | 'profile';
