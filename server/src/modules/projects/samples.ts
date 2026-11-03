/** Seed content for the example space and the built-in form templates. Original wording. */

type Sample = {
  ref: string; summary: string; type: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
  status: 'todo' | 'in_progress' | 'in_review' | 'done'; priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest' | 'none';
  parent?: string; daysAgo: number; dueIn?: number; startIn?: number; description?: string;
};

export const SAMPLE_ITEMS: Sample[] = [
  { ref: 'auth', summary: 'Implement user authentication', type: 'epic', status: 'in_progress', priority: 'high', daysAgo: 6, startIn: -10, dueIn: 12,
    description: 'Sign-up, sign-in, sessions and password reset for the billing portal.' },
  { ref: 'analytics', summary: 'Build market analysis tools', type: 'epic', status: 'in_progress', priority: 'medium', daysAgo: 6, startIn: -4, dueIn: 30 },
  { ref: 'testing', summary: 'Run user testing for the platform', type: 'epic', status: 'in_progress', priority: 'medium', daysAgo: 5, startIn: 0, dueIn: 21 },
  { ref: 'launch', summary: 'Prepare for project launch', type: 'epic', status: 'todo', priority: 'high', daysAgo: 5, startIn: 14, dueIn: 40 },
  { ref: 'review', summary: 'Post-launch review and feedback collection', type: 'epic', status: 'done', priority: 'low', daysAgo: 5, startIn: -20, dueIn: -2 },
  { ref: 'notify', summary: 'Set up notifications for users', type: 'task', status: 'todo', priority: 'medium', parent: 'auth', daysAgo: 4, dueIn: 15 },
  { ref: 'wallet', summary: 'Create wallet integration', type: 'task', status: 'in_progress', priority: 'high', parent: 'analytics', daysAgo: 4, dueIn: 16 },
  { ref: 'history', summary: 'Develop transaction history feature', type: 'story', status: 'todo', priority: 'medium', parent: 'analytics', daysAgo: 3, dueIn: 20 },
  { ref: 'perf', summary: 'Optimise performance of the application', type: 'task', status: 'todo', priority: 'low', parent: 'analytics', daysAgo: 3, dueIn: 11 },
  { ref: 'docs', summary: 'Finalise documentation for the project', type: 'task', status: 'in_review', priority: 'medium', parent: 'review', daysAgo: 2, dueIn: 9 },
  { ref: 'rounding', summary: 'Invoice totals round the wrong way on refunds', type: 'bug', status: 'todo', priority: 'highest', parent: 'testing', daysAgo: 1, dueIn: -1,
    description: 'Partial refunds show totals one cent too high when tax applies.' },
];

export type FormFieldDef = {
  id: string; label: string; type: 'text' | 'textarea' | 'select' | 'date' | 'user' | 'priority';
  required: boolean; options: string[]; mapTo: 'summary' | 'description' | 'priority' | 'dueDate' | 'assignee' | null;
};
export type FormTemplate = { id: string; name: string; description: string; itemType: 'task' | 'story' | 'bug' | 'epic' | 'subtask'; fields: FormFieldDef[] };

const f = (id: string, label: string, type: FormFieldDef['type'], mapTo: FormFieldDef['mapTo'] = null, required = false, options: string[] = []): FormFieldDef =>
  ({ id, label, type, required, options, mapTo });

export const FORM_TEMPLATES: FormTemplate[] = [
  { id: 'blank', name: 'Blank form', description: 'Start from a title and a description.', itemType: 'task',
    fields: [f('title', 'Title', 'text', 'summary', true), f('details', 'Details', 'textarea', 'description')] },
  { id: 'feature', name: 'Feature request', description: 'Collect ideas for new features from anyone in the workspace.', itemType: 'story',
    fields: [f('title', 'What should we build?', 'text', 'summary', true), f('problem', 'What problem does it solve?', 'textarea', 'description', true),
      f('who', 'Who is it for?', 'text'), f('urgency', 'How important is it?', 'priority', 'priority')] },
  { id: 'bug', name: 'Bug report', description: 'Capture what went wrong and how to reproduce it.', itemType: 'bug',
    fields: [f('title', 'What went wrong?', 'text', 'summary', true), f('steps', 'Steps to reproduce', 'textarea', 'description', true),
      f('expected', 'What did you expect?', 'textarea'), f('severity', 'Severity', 'priority', 'priority'),
      f('area', 'Where did it happen?', 'select', null, false, ['Web app', 'Mobile app', 'API', 'Billing', 'Other'])] },
  { id: 'incident', name: 'Incident report', description: 'Report a live problem so the team can respond quickly.', itemType: 'bug',
    fields: [f('title', 'Incident summary', 'text', 'summary', true), f('impact', 'Who is affected and how?', 'textarea', 'description', true),
      f('severity', 'Severity', 'priority', 'priority', true), f('started', 'When did it start?', 'date'), f('owner', 'Incident lead', 'user', 'assignee')] },
  { id: 'techreview', name: 'Technical review', description: 'Ask for a design or code review with a due date.', itemType: 'task',
    fields: [f('title', 'What needs reviewing?', 'text', 'summary', true), f('context', 'Context and links', 'textarea', 'description', true),
      f('reviewer', 'Reviewer', 'user', 'assignee'), f('due', 'Review needed by', 'date', 'dueDate')] },
];
