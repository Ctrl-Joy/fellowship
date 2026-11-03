/** Wire types for the projects module (see docs/PROJECTS.md and server/src/modules/projects). */

export type TabKey = 'summary' | 'list' | 'board' | 'development' | 'forms' | 'timeline' | 'docs';
export type ItemType = 'epic' | 'story' | 'task' | 'bug' | 'subtask';
export type ItemStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest' | 'none';

export interface TabConfig { order: TabKey[]; hidden: TabKey[]; labels: Partial<Record<TabKey, string>>; default: TabKey }

export interface Project {
  id: string; workspaceId: string; key: string; name: string; iconEmoji: string; color: string; description: string;
  leadId: string | null; createdBy: string; createdAt: number; updatedAt: number; tabs: TabConfig;
  itemCount: number; doneCount: number; starred: boolean; visitedAt: number | null;
}

export interface WorkItem {
  id: string; projectId: string; key: string; number: number; type: ItemType; summary: string; description: string;
  status: ItemStatus; priority: Priority; assigneeId: string | null; reporterId: string | null; parentId: string | null;
  startDate: string | null; dueDate: string | null; rank: number; labels: string[];
  createdAt: number; updatedAt: number; resolvedAt: number | null; reopenedCount: number;
  childCount: number; childDone: number; childInProgress: number;
}

export interface Activity {
  id: string; itemId: string; projectId: string; actorId: string | null; field: string;
  from: string | null; to: string | null; createdAt: number;
  itemKey: string | null; itemSummary: string | null; itemStatus: ItemStatus | null; itemType: ItemType | null;
}

export interface Comment { id: string; itemId: string; userId: string; text: string; createdAt: number; editedAt: number | null }

export interface Summary {
  days: number;
  stats: { completed: number; updated: number; created: number; dueSoon: number };
  total: number;
  status: Partial<Record<ItemStatus, number>>;
  priority: Partial<Record<Priority, number>>;
  types: Partial<Record<ItemType, number>>;
  workload: { assigneeId: string | null; count: number }[];
  epics: { id: string; key: string; summary: string; status: ItemStatus; total: number; done: number; inProgress: number; todo: number }[];
  activity: Activity[];
}

export interface DevData {
  metrics: {
    completedThisWeek: number; completedSeries: number[]; prCycleTimeHours: number | null; leadTimeHours: number | null;
    overdue: number; reopened: number; bugsOpen: number; prsOpen: number; criticalVulnerabilities: number;
  };
  pullRequests: { ref: string; title: string; state: 'open' | 'merged' | 'closed'; url?: string; repo?: string; author?: string; openedAt: number; mergedAt: number | null; updatedAt: number }[];
  deployments: { ref: string; environment: string; status: string; prIds: string[]; url?: string; deployedAt: number }[];
  vulnerabilities: { ref: string; title: string; severity: string; status: string; url?: string; updatedAt: number }[];
  repositories: { ref: string; name: string; url?: string }[];
  hookPath: string;
}

export type FieldType = 'text' | 'textarea' | 'select' | 'date' | 'user' | 'priority';
export interface FormField { id: string; label: string; type: FieldType; required: boolean; options: string[]; mapTo: 'summary' | 'description' | 'priority' | 'dueDate' | 'assignee' | null }
export interface FormTemplate { id: string; name: string; description: string; itemType: ItemType; fields: FormField[] }
export interface ProjectForm {
  id: string; projectId: string; name: string; description: string; template: string; itemType: ItemType;
  fields: FormField[]; active: boolean; createdBy: string; createdAt: number; updatedAt: number; submissions: number;
}

export interface ItemQuery { projectId?: string; text?: string; ask?: string; assignee?: string[]; status?: string[]; type?: string[]; priority?: string[] }
export interface SavedFilter { id: string; name: string; query: ItemQuery; starred: boolean; createdAt: number }

export type WidgetType = 'stats' | 'status' | 'priority' | 'types' | 'workload' | 'epics' | 'activity' | 'filter';
export interface Widget { id: string; type: WidgetType; projectId?: string | null; filterId?: string | null; title?: string }
export interface Dashboard { id: string; name: string; ownerId: string; widgets: Widget[]; createdAt: number; updatedAt: number }

export const STATUS_LABEL: Record<ItemStatus, string> = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' };
export const STATUS_ORDER: ItemStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
export const PRIORITY_LABEL: Record<Priority, string> = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest', none: 'None' };
export const PRIORITY_ORDER: Priority[] = ['highest', 'high', 'medium', 'low', 'lowest', 'none'];
export const TYPE_LABEL: Record<ItemType, string> = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Subtask' };
export const TYPE_ORDER: ItemType[] = ['epic', 'story', 'task', 'bug', 'subtask'];
export const TAB_LABEL: Record<TabKey, string> = { summary: 'Summary', list: 'List', board: 'Board', development: 'Development', forms: 'Forms', timeline: 'Timeline', docs: 'Docs' };
