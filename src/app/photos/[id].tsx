import { Redirect, useLocalSearchParams } from 'expo-router';

import { PhotoViewerScreen } from '@/components/candidate/PhotoViewerScreen';
import { findCandidate } from '@/features/matches/candidates';

export default function PhotosRoute() {
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const candidate = findCandidate(id);
  if (!candidate) return <Redirect href="/" />;
  return <PhotoViewerScreen candidate={candidate} initialIndex={Number(index ?? 0) || 0} />;
}
