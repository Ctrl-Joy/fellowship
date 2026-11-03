import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, runMigrations } from './db';
import { createBus } from './bus';
import { createAuth } from './auth';
import { createRealtime } from './realtime';
import { ids } from './ids';
import { HttpError } from './errors';
import { createAccess } from './modules/core/access';
import { createMessageService } from './modules/core/messages';
import { modules } from './modules';
import type { AppConfig, ModuleContext } from './context';
import type { CoreApi } from './modules/core';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = resolve(here, '..', 'data');
export const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, 'fellowship.db');

declare module 'fastify' {
  interface FastifyInstance {
    ctx: ModuleContext;
  }
}

export interface BuildOptions {
  dbPath?: string;
  uploadsDir?: string;
  port?: number;
  logger?: boolean;
  isTest?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const dataDir = dbPath === ':memory:' ? DEFAULT_DATA_DIR : dirname(resolve(dbPath));
  const config: AppConfig = {
    dbPath,
    dataDir,
    uploadsDir: opts.uploadsDir ?? join(dataDir, 'uploads'),
    port: opts.port ?? Number(process.env.API_PORT ?? 4000),
    isTest: opts.isTest ?? false,
  };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const db = openDb(dbPath);
  runMigrations(db, modules);

  const bus = createBus((err, ev) => app.log.error({ err, type: ev.type }, 'bus handler failed'));
  const auth = createAuth(db);
  const realtime = createRealtime(db, bus, auth);
  const access = createAccess(db);
  const messages = createMessageService(db, bus, ids, access);
  const closers: (() => void | Promise<void>)[] = [];

  const ctx: ModuleContext = {
    db, bus, realtime, auth, config, ids, messages, access,
    core: {} as CoreApi,
    onClose: (fn) => { closers.push(fn); },
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err.validation) {
      return reply.status(400).send({ error: { code: 'bad_request', message: err.message } });
    }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({
      error: { code: err.code ?? (status >= 500 ? 'internal' : 'error'), message: status >= 500 ? 'Something went wrong' : err.message },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } });
  });

  app.get('/api/health', async () => ({ ok: true }));

  realtime.register(app);
  for (const mod of modules) await mod.register(app, ctx);

  app.addHook('onClose', async () => {
    for (const fn of closers) await fn();
    realtime.closeAll();
    db.close();
  });

  return app;
}
