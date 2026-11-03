import type { FeatureSetup } from '../types';
import { ws } from '../../ws';
import { useWorkflowRuns } from './store';

/** Keep run summaries live for the builder's history view and status chips. */
const setup: FeatureSetup = () => {
  const off = ws.on('workflow.run_updated', (payload: any) => {
    if (payload?.run?.id) useWorkflowRuns.getState().upsert(payload.run);
  });
  return () => { off(); };
};

export default setup;
