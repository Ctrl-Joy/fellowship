import type { FeatureSetup, FeatureSetupContext } from './types';
import threads from './threads/setup';
import reactions from './reactions/setup';
import files from './files/setup';
import search from './search/setup';
import notifications from './notifications/setup';
import presence from './presence/setup';
import huddles from './huddles/setup';
import canvases from './canvases/setup';
import apps from './apps/setup';
import workflows from './workflows/setup';

const setups: FeatureSetup[] = [threads, reactions, files, search, notifications, presence, huddles, canvases, apps, workflows];

/** Run every feature's setup for a workspace; returns a combined cleanup. Owned by core. */
export function setupFeatures(ctx: FeatureSetupContext): () => void {
  const cleanups = setups.map((fn) => {
    try { return fn(ctx); } catch (err) { console.error('[feature setup]', err); return undefined; }
  });
  return () => { for (const c of cleanups) if (typeof c === 'function') c(); };
}
