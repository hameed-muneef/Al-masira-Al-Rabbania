import {authClient} from '../auth';
import {createQuranState, mergeQuranState} from './learning';
import type {QuranLearningState} from './types';

const ARRAY_KEYS = ['bookmarks', 'notes', 'history', 'plans', 'passages', 'revisionEvents', 'reflections', 'routine', 'hadithBookmarks', 'activityLog'] as const;

function normalizeRemote(payload: Partial<QuranLearningState> | null): QuranLearningState | null {
  if (!payload || typeof payload !== 'object') return null;
  const base = createQuranState();
  const state = {...base, ...payload} as QuranLearningState;
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(state[key])) (state as unknown as Record<string, unknown>)[key] = [];
  }
  state.settings = payload.settings ?? base.settings;
  return state;
}

export async function fetchQuranLearningState(): Promise<QuranLearningState | null> {
  if (!authClient) return null;
  const {data, error} = await authClient.rpc('load_quran_learning_state');
  if (error) throw error;
  return normalizeRemote(data as Partial<QuranLearningState> | null);
}

export async function saveQuranLearningState(state: QuranLearningState): Promise<void> {
  if (!authClient) return;
  const {error} = await authClient.rpc('save_quran_learning_state', {p_state: state});
  if (error) throw error;
}

export async function syncQuranState(local: QuranLearningState): Promise<QuranLearningState> {
  const remote = await fetchQuranLearningState();
  return remote ? mergeQuranState(local, remote) : local;
}
