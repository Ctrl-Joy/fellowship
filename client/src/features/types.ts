import type { User } from '../types';

export interface FeatureSetupContext {
  workspaceId: string;
  me: User;
}

/** A feature's per-workspace initializer; returns an optional cleanup function. */
export type FeatureSetup = (ctx: FeatureSetupContext) => void | (() => void);
