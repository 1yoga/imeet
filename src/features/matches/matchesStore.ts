import { create } from 'zustand';

import { candidates } from './candidates';

type Verdict = 'like' | 'skip';

interface MatchesState {
  /** Индекс текущей карточки в списке кандидатов. */
  index: number;
  verdicts: Record<string, Verdict>;
  decide: (id: string, verdict: Verdict) => void;
  restart: () => void;
}

export const useMatchesStore = create<MatchesState>((set) => ({
  index: 0,
  verdicts: {},
  decide: (id, verdict) => set((state) => ({
    index: Math.min(state.index + 1, candidates.length),
    verdicts: { ...state.verdicts, [id]: verdict },
  })),
  restart: () => set({ index: 0, verdicts: {} }),
}));
