import { create } from 'zustand';
import type { RunSummary } from './model';

/** Live run summaries pushed by `workflow.run_updated` (keyed by run id). */
interface RunsState {
  byId: Record<string, RunSummary>;
  /** Bumped on every update so views can refetch details. */
  seq: number;
  upsert(run: RunSummary): void;
}

export const useWorkflowRuns = create<RunsState>((set) => ({
  byId: {},
  seq: 0,
  upsert: (run) => set((s) => ({ byId: { ...s.byId, [run.id]: run }, seq: s.seq + 1 })),
}));
