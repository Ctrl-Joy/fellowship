import type { FastifyInstance } from 'fastify';
import type { Db } from './db';
import type { Bus } from './bus';
import type { Realtime } from './realtime';
import type { Auth } from './auth';
import type { Ids } from './ids';
import type { MessageService } from './modules/core/messages';
import type { Access } from './modules/core/access';
import type { CoreApi } from './modules/core';

export interface AppConfig {
  dbPath: string;
  dataDir: string;
  uploadsDir: string;
  port: number;
  /** true inside buildApp() for tests (no timers that keep the process alive, etc.) */
  isTest: boolean;
}

export interface ModuleContext {
  db: Db;
  bus: Bus;
  realtime: Realtime;
  auth: Auth;
  config: AppConfig;
  ids: Ids;
  /** Message serialization, enrichers and the single post() path (owned by core). */
  messages: MessageService;
  /** Membership / permission helpers (owned by core). */
  access: Access;
  /** Core helpers: createUser, createWorkspace, joinWorkspace, createChannel, addMember, openDm. */
  core: CoreApi;
  /** Register cleanup to run when the app closes (timers, intervals…). */
  onClose(fn: () => void | Promise<void>): void;
}

export interface FellowshipModule {
  name: string;
  migrations: string[];
  register(app: FastifyInstance, ctx: ModuleContext): void | Promise<void>;
}
