import { Redirect, useLocalSearchParams } from 'expo-router';

import { CandidateProfileScreen } from '@/components/candidate/CandidateProfileScreen';
import { findCandidate } from '@/features/matches/candidates';

export default function CandidateRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const candidate = findCandidate(id);
  if (!candidate) return <Redirect href="/" />;
  return <CandidateProfileScreen candidate={candidate} />;
}
