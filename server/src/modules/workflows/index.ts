import type { FellowshipModule } from '../../context';
import { workflowMigrations } from './schema';
import { createEngine } from './engine';
import { registerWorkflowRoutes } from './routes';

/**
 * Workflow automation: triggers → ordered steps (with branches, forms, approvals, delays),
 * executed by a durable engine persisted in SQLite and resumed by a 1 s scheduler tick.
 */
const workflows: FellowshipModule = {
  name: 'workflows',
  migrations: workflowMigrations,
  register(app, ctx) {
    const engine = createEngine(app, ctx);
    registerWorkflowRoutes(app, ctx, engine);
    // Resume runs interrupted mid-step by a restart (waiting runs resume on tick / user action).
    engine.resumeOnBoot();
    if (!ctx.config.isTest) {
      const timer = setInterval(() => {
        try { engine.tick(); } catch (err) { app.log.error({ err }, 'workflow scheduler tick failed'); }
      }, 1000);
      timer.unref?.();
      ctx.onClose(() => clearInterval(timer));
    }
    ctx.onClose(() => engine.idle());
  },
};

export default workflows;
