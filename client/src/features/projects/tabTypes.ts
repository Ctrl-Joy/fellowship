import type { User } from '../../types';
import type { Project } from './types';

/** Props every space tab receives from ProjectPage. */
export interface TabProps { workspaceId: string; project: Project; currentUser: User }
