import type { FeatureSetup } from '../types';

/**
 * Called once per workspace load (see features/index.ts). Subscribe to WS events with
 * `ws.on(type, fn)` here and return a cleanup function. Stub created by core for 'apps'.
 */
const setup: FeatureSetup = () => {
  return () => {};
};

export default setup;
