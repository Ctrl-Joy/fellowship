import type { FellowshipModule } from '../../context';
import { coreMigrations } from './schema';
import { registerAuthRoutes } from './routes-auth';
import { registerConversationRoutes } from './routes-conversations';
import { registerWorkspaceRoutes } from './routes-workspaces';
import { registerMessageRoutes } from './routes-messages';

/** Helpers core exposes to other modules as `ctx.core` (filled when core registers, i.e. first). */
export interface CoreApi {
  createUser: ReturnType<typeof registerAuthRoutes>['createUser'];
  createWorkspace: ReturnType<typeof registerWorkspaceRoutes>['createWorkspace'];
  joinWorkspace: ReturnType<typeof registerWorkspaceRoutes>['joinWorkspace'];
  createChannel: ReturnType<typeof registerConversationRoutes>['createChannel'];
  addMember: ReturnType<typeof registerConversationRoutes>['addMember'];
  openDm: ReturnType<typeof registerConversationRoutes>['openDm'];
}

const core: FellowshipModule = {
  name: 'core',
  migrations: coreMigrations,
  register(app, ctx) {
    const { createUser } = registerAuthRoutes(app, ctx);
    const conv = registerConversationRoutes(app, ctx);
    const ws = registerWorkspaceRoutes(app, ctx, conv);
    registerMessageRoutes(app, ctx);
    Object.assign(ctx.core, { createUser, ...ws, ...conv } satisfies CoreApi);
  },
};

export default core;
