import { Redirect, useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/components/chat/ChatScreen';
import { findCandidate } from '@/features/matches/candidates';

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const candidate = findCandidate(id);
  if (!candidate) return <Redirect href="/" />;
  return <ChatScreen candidate={candidate} />;
}
