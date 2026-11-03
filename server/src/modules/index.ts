import type { FellowshipModule } from '../context';
import core from './core';
import threads from './threads';
import reactions from './reactions';
import files from './files';
import search from './search';
import notifications from './notifications';
import presence from './presence';
import huddles from './huddles';
import canvases from './canvases';
import apps from './apps';
import workflows from './workflows';
import projects from './projects';

/** Ordered: migrations and register() run in this order. core must stay first. */
export const modules: FellowshipModule[] = [
  core,
  threads,
  reactions,
  files,
  search,
  notifications,
  presence,
  huddles,
  canvases,
  apps,
  workflows,
  projects,
];
