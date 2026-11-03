import type { FastifyInstance } from 'fastify';
import type { FellowshipModule, ModuleContext } from '../../context';
import { appsMigrations } from './schema';
import { createAppsService } from './service';
import { createEventDeliveries } from './events';
import { createCommandRunner, registerCommandRoutes } from './commands';
import { registerManagementRoutes } from './manage';
import { registerBotRoutes } from './bot';
import { registerHookRoutes } from './hooks';
import { registerInteractiveRoutes } from './interactive';

declare module 'fastify' {
  interface FastifyInstance {
    /** Deliver reminders that are due at `now` (tests drive the clock with this). */
    appsRunReminders(now?: number): number;
  }
}

const apps: FellowshipModule = {
  name: 'apps',
  migrations: appsMigrations,
  register(app: FastifyInstance, ctx: ModuleContext) {
    app.decorateRequest('bot', null);
    const svc = createAppsService(ctx);
    const deliveries = createEventDeliveries(ctx, svc);
    const runner = createCommandRunner(ctx, svc);

    registerManagementRoutes(app, ctx, svc, deliveries);
    registerCommandRoutes(app, ctx, svc, runner);
    registerBotRoutes(app, ctx, svc);
    registerHookRoutes(app, ctx, svc, runner);
    registerInteractiveRoutes(app, ctx, svc);

    app.decorate('appsRunReminders', (now?: number) => svc.runReminders(now));
    svc.startScheduler();
  },
};

export default apps;
