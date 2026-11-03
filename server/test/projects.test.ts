import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signup, type TestClient } from './helpers';
import { parseAsk } from '../src/modules/projects/query';

let env: Awaited<ReturnType<typeof makeTestApp>>;
let ava: TestClient, ben: TestClient, outsider: TestClient;
let wid: string, cid: string, pid: string;

before(async () => {
  env = await makeTestApp();
  ava = await signup(env.app, 'Ava Proj');
  ben = await signup(env.app, 'Ben Proj');
  outsider = await signup(env.app, 'Out Proj');
  wid = (await ava.post('/api/workspaces', { name: 'Projects WS' })).body.workspace.id;
  const invite = (await ava.get(`/api/w/${wid}`)).body.workspace.inviteCode;
  await ben.post(`/api/workspaces/join/${invite}`);
  await outsider.post('/api/workspaces', { name: 'Elsewhere' });
  cid = (await ava.post(`/api/w/${wid}/channels`, { name: 'eng' })).body.conversation.id;
  const r = await ava.post(`/api/w/${wid}/projects`, { name: 'Billing Platform', key: 'BIL' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pid = r.body.project.id;
});
after(() => env.cleanup());

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('spaces', () => {
  test('keys are unique per workspace and suggested when omitted', async () => {
    const dup = await ava.post(`/api/w/${wid}/projects`, { name: 'Other', key: 'BIL' });
    assert.equal(dup.status, 400);
    const auto = await ava.post(`/api/w/${wid}/projects`, { name: 'Mobile App Team' });
    assert.equal(auto.body.project.key, 'MAT');
    const list = await ben.get(`/api/w/${wid}/projects`);
    assert.ok(list.body.projects.length >= 2);
  });

  test('non-members cannot see or touch a space', async () => {
    assert.equal((await outsider.get(`/api/projects/${pid}`)).status, 404);
    assert.equal((await outsider.get(`/api/projects/${pid}/items`)).status, 404);
    assert.equal((await outsider.post(`/api/projects/${pid}/items`, { summary: 'x' })).status, 404);
    assert.equal((await outsider.get(`/api/w/${wid}/projects`)).status, 404, 'core hides workspaces from strangers');
  });

  test('star, visit and tab settings are saved', async () => {
    const s = await ben.post(`/api/projects/${pid}/star`);
    assert.equal(s.body.project.starred, true);
    assert.equal((await ava.get(`/api/projects/${pid}`)).body.project.starred, false, 'stars are per person');
    await ben.post(`/api/projects/${pid}/visit`);
    const fy = await ben.get(`/api/w/${wid}/for-you`);
    assert.equal(fy.body.recentSpaces[0].id, pid);

    const t = await ava.patch(`/api/projects/${pid}`, { tabs: { default: 'board', labels: { list: 'Backlog' }, order: ['board', 'list'] } });
    assert.equal(t.body.project.tabs.default, 'board');
    assert.equal(t.body.project.tabs.labels.list, 'Backlog');
    assert.deepEqual(t.body.project.tabs.order.slice(0, 2), ['board', 'list']);
    assert.equal(t.body.project.tabs.order.length, 7, 'every tab stays in the order');
    const bad = await ava.patch(`/api/projects/${pid}`, { tabs: { hidden: ['board'] } });
    assert.equal(bad.status, 400, 'the default tab cannot be hidden');
  });

  test('only the creator or an admin can delete a space', async () => {
    const p = (await ben.post(`/api/w/${wid}/projects`, { name: 'Ben Space', key: 'BEN' })).body.project;
    // Ava is the workspace owner, so she may; another member may not.
    const mine = (await ava.post(`/api/w/${wid}/projects`, { name: 'Ava Space', key: 'AVA' })).body.project;
    assert.equal((await ben.del(`/api/projects/${mine.id}`)).status, 403);
    assert.equal((await ben.del(`/api/projects/${p.id}`)).status, 200);
    assert.equal((await ben.get(`/api/projects/${p.id}`)).status, 404);
  });
});

describe('work items', () => {
  let epic: any, task: any;
  before(async () => {
    epic = (await ava.post(`/api/projects/${pid}/items`, { summary: 'Payments epic', type: 'epic', priority: 'high' })).body.item;
    task = (await ava.post(`/api/projects/${pid}/items`, { summary: 'Wire up card form', parentId: epic.id, type: 'task', assigneeId: ben.user.id, dueDate: inDays(3) })).body.item;
  });

  test('keys number up per space and parents count children', async () => {
    assert.equal(epic.key, 'BIL-1');
    assert.equal(task.key, 'BIL-2');
    assert.equal(task.reporterId, ava.user.id);
    const e = (await ava.get(`/api/items/${epic.id}`)).body;
    assert.equal(e.item.childCount, 1);
    assert.equal(e.children[0].id, task.id);
    const byKey = await ben.get(`/api/w/${wid}/items/by-key/bil-2`);
    assert.equal(byKey.body.item.id, task.id);
  });

  test('parent rules: same space, no loops, epics have no parent', async () => {
    const other = (await ava.post(`/api/w/${wid}/projects`, { name: 'Elsewhere Space', key: 'ELS' })).body.project;
    const foreign = (await ava.post(`/api/projects/${other.id}/items`, { summary: 'Foreign' })).body.item;
    assert.equal((await ava.patch(`/api/items/${task.id}`, { parentId: foreign.id })).status, 400);
    assert.equal((await ava.patch(`/api/items/${epic.id}`, { parentId: task.id })).status, 400);
    const sub = (await ava.post(`/api/projects/${pid}/items`, { summary: 'Sub', parentId: task.id })).body.item;
    assert.equal(sub.type, 'subtask', 'children default to subtasks');
    assert.equal((await ava.patch(`/api/items/${task.id}`, { parentId: sub.id, type: 'task' })).status, 400, 'no loops');
    assert.equal((await ava.post(`/api/projects/${pid}/items`, { summary: 'x', parentId: sub.id })).status, 400, 'subtasks have no children');
    assert.equal((await ava.post(`/api/projects/${pid}/items`, { summary: 'x', assigneeId: outsider.user.id })).status, 400);
  });

  test('edits are logged, reopening counts, assignment notifies', async () => {
    const seen: any[] = [];
    const off = env.app.ctx.bus.on('*', (e) => seen.push(e));
    await ben.patch(`/api/items/${task.id}`, { status: 'done' });
    let it = (await ben.get(`/api/items/${task.id}`)).body.item;
    assert.ok(it.resolvedAt);
    await ben.patch(`/api/items/${task.id}`, { status: 'in_progress', priority: 'medium' });
    it = (await ben.get(`/api/items/${task.id}`)).body.item;
    assert.equal(it.resolvedAt, null);
    assert.equal(it.reopenedCount, 1);
    await ben.patch(`/api/items/${task.id}`, { assigneeId: ava.user.id });
    off();
    const assigned = seen.find((e) => e.type === 'item.assigned');
    assert.deepEqual(assigned.audience, [ava.user.id]);
    assert.ok(seen.some((e) => e.type === 'item.updated' && e.payload.item.id === epic.id), 'parent refreshed');

    const act = (await ava.get(`/api/items/${task.id}/activity`)).body.activity;
    const fields = act.map((a: any) => a.field);
    for (const f of ['status', 'priority', 'assignee', 'created']) assert.ok(fields.includes(f), `${f} logged`);
    const statusChange = act.find((a: any) => a.field === 'status' && a.to === 'in_progress');
    assert.equal(statusChange.from, 'done');
  });

  test('rank moves an item between neighbours and can change status', async () => {
    const a = (await ava.post(`/api/projects/${pid}/items`, { summary: 'A' })).body.item;
    const b = (await ava.post(`/api/projects/${pid}/items`, { summary: 'B' })).body.item;
    const c = (await ava.post(`/api/projects/${pid}/items`, { summary: 'C' })).body.item;
    const moved = (await ava.post(`/api/items/${c.id}/rank`, { afterId: a.id, beforeId: b.id, status: 'in_review' })).body.item;
    assert.ok(moved.rank > a.rank && moved.rank < b.rank);
    assert.equal(moved.status, 'in_review');
    const order = (await ava.get(`/api/projects/${pid}/items?q=${encodeURIComponent('')}`)).body.items.map((i: any) => i.summary).filter((s: string) => ['A', 'B', 'C'].includes(s));
    assert.deepEqual(order, ['A', 'C', 'B']);
  });

  test('filters and ask', async () => {
    const bugs = await ava.post(`/api/projects/${pid}/items`, { summary: 'Checkout crashes on Safari', type: 'bug', priority: 'highest', assigneeId: ben.user.id, dueDate: inDays(-2) });
    assert.equal(bugs.status, 200);
    const byType = (await ava.get(`/api/projects/${pid}/items?type=bug`)).body.items;
    assert.ok(byType.every((i: any) => i.type === 'bug') && byType.length >= 1);
    const asked = (await ben.get(`/api/projects/${pid}/items?ask=${encodeURIComponent('my overdue bugs')}`)).body;
    assert.deepEqual(asked.items.map((i: any) => i.summary), ['Checkout crashes on Safari']);
    assert.ok(asked.explanation.includes('assigned to you'));
    const text = (await ava.get(`/api/projects/${pid}/items?q=safari`)).body.items;
    assert.equal(text.length, 1);
    const cross = (await ava.get(`/api/w/${wid}/items?ask=${encodeURIComponent('highest priority not done')}`)).body.items;
    assert.ok(cross.some((i: any) => i.summary.includes('Safari')));
  });

  test('comments and sharing into a channel', async () => {
    const c = await ben.post(`/api/items/${epic.id}/comments`, { text: 'Kick-off on Monday' });
    assert.equal(c.status, 200);
    assert.equal((await ava.get(`/api/items/${epic.id}/comments`)).body.comments.length, 1);
    const shared = await ava.post(`/api/items/${epic.id}/share`, { conversationId: cid });
    assert.equal(shared.status, 200);
    assert.equal(shared.body.message.subtype, 'work_item');
    assert.equal(shared.body.message.meta.workItem.key, 'BIL-1');
    const priv = (await ben.post(`/api/w/${wid}/channels`, { name: 'ben-only', isPrivate: true })).body.conversation.id;
    assert.equal((await ava.post(`/api/items/${epic.id}/share`, { conversationId: priv })).status, 403);
  });

  test('deleting removes children too', async () => {
    const parent = (await ava.post(`/api/projects/${pid}/items`, { summary: 'Temp epic', type: 'epic' })).body.item;
    const kid = (await ava.post(`/api/projects/${pid}/items`, { summary: 'Temp kid', parentId: parent.id, type: 'task' })).body.item;
    const r = await ava.del(`/api/items/${parent.id}`);
    assert.equal(r.body.deleted, 2);
    assert.equal((await ava.get(`/api/items/${kid.id}`)).status, 404);
  });
});

describe('summary and development', () => {
  test('summary numbers match the items', async () => {
    const p = (await ava.post(`/api/w/${wid}/projects`, { name: 'Summary Space', key: 'SUM' })).body.project;
    const e = (await ava.post(`/api/projects/${p.id}/items`, { summary: 'Epic', type: 'epic' })).body.item;
    await ava.post(`/api/projects/${p.id}/items`, { summary: 't1', parentId: e.id, type: 'task', status: 'done', priority: 'high', assigneeId: ben.user.id });
    await ava.post(`/api/projects/${p.id}/items`, { summary: 't2', parentId: e.id, type: 'task', status: 'in_progress', dueDate: inDays(2) });
    await ava.post(`/api/projects/${p.id}/items`, { summary: 't3', parentId: e.id, type: 'story', dueDate: today() });
    const s = (await ben.get(`/api/projects/${p.id}/summary`)).body;
    assert.equal(s.total, 4);
    assert.equal(s.stats.created, 4);
    assert.equal(s.stats.completed, 1);
    assert.equal(s.stats.dueSoon, 2);
    assert.equal(s.status.done, 1);
    assert.equal(s.status.todo, 2);
    assert.equal(s.priority.high, 1);
    assert.equal(s.types.task, 2);
    assert.deepEqual(s.epics[0], { id: e.id, key: 'SUM-1', summary: 'Epic', status: 'todo', total: 3, done: 1, inProgress: 1, todo: 1 });
    assert.ok(s.workload.some((w: any) => w.assigneeId === ben.user.id && w.count === 1));
    assert.ok(s.activity.length >= 4 && s.activity[0].itemKey.startsWith('SUM-'));
    const mine = (await ben.get(`/api/projects/${p.id}/summary?assignee=me`)).body;
    assert.equal(mine.total, 1, 'people filter narrows the summary');
  });

  test('dev hook feeds pull requests, deployments and vulnerabilities', async () => {
    const dev0 = (await ava.get(`/api/projects/${pid}/development`)).body;
    assert.equal(dev0.metrics.prsOpen, 0);
    const hook = dev0.hookPath;
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/hooks/dev/nope', payload: { type: 'repository', id: 'r', name: 'x' } })).statusCode, 404);
    const send = (payload: any) => env.app.inject({ method: 'POST', url: hook, payload });
    assert.equal((await send({ type: 'pull_request', id: '17', action: 'opened', title: 'Add refunds' })).statusCode, 200);
    await send({ type: 'pull_request', id: '18', action: 'opened', title: 'Fix rounding' });
    await send({ type: 'pull_request', id: '17', action: 'merged' });
    await send({ type: 'deployment', id: 'd1', prIds: ['17'], status: 'success' });
    await send({ type: 'vulnerability', id: 'v1', title: 'Old TLS', severity: 'critical' });
    await send({ type: 'repository', id: 'billing', name: 'acme/billing' });
    const dev = (await ava.get(`/api/projects/${pid}/development`)).body;
    assert.equal(dev.metrics.prsOpen, 1);
    assert.equal(dev.metrics.criticalVulnerabilities, 1);
    assert.ok(dev.metrics.prCycleTimeHours != null && dev.metrics.leadTimeHours != null);
    assert.equal(dev.pullRequests.find((x: any) => x.ref === '17').title, 'Add refunds', 'merge keeps earlier fields');
    assert.equal(dev.repositories.length, 1);
    assert.equal(dev.metrics.completedSeries.length, 7);
    assert.ok(dev.metrics.bugsOpen >= 1 && dev.metrics.overdue >= 1);
  });
});

describe('forms, filters, dashboards, sample', () => {
  test('a form submission creates a work item', async () => {
    const tpl = await ava.get(`/api/projects/${pid}/forms`);
    assert.ok(tpl.body.templates.some((t: any) => t.id === 'bug'));
    const form = (await ava.post(`/api/projects/${pid}/forms`, { name: 'Report a bug', template: 'bug' })).body.form;
    assert.equal(form.itemType, 'bug');
    assert.equal((await ben.post(`/api/forms/${form.id}/submit`, { values: { steps: 'no title' } })).status, 400);
    assert.equal((await ben.post(`/api/forms/${form.id}/submit`, { values: { title: 'x', steps: 'y', area: 'Moon' } })).status, 400);
    const r = await ben.post(`/api/forms/${form.id}/submit`, { values: { title: 'Logo blurry', steps: 'Open on retina', severity: 'low', area: 'Web app' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.type, 'bug');
    assert.equal(r.body.item.priority, 'low');
    assert.equal(r.body.item.reporterId, ben.user.id);
    assert.match(r.body.item.description, /Open on retina[\s\S]*Web app/);
    assert.equal((await ava.get(`/api/forms/${form.id}`)).body.form.submissions, 1);
    await ava.patch(`/api/forms/${form.id}`, { active: false });
    assert.equal((await ben.post(`/api/forms/${form.id}/submit`, { values: { title: 'x', steps: 'y' } })).status, 400);
  });

  test('saved filters are private; dashboards are owner-edited', async () => {
    const f = (await ava.post(`/api/w/${wid}/project-filters`, { name: 'My bugs', query: { ask: 'my bugs' } })).body.filter;
    assert.equal((await ava.get(`/api/w/${wid}/project-filters`)).body.filters.length, 1);
    assert.equal((await ben.get(`/api/w/${wid}/project-filters`)).body.filters.length, 0);
    assert.equal((await ben.del(`/api/project-filters/${f.id}`)).status, 404);
    const d = (await ava.post(`/api/w/${wid}/dashboards`, { name: 'Team', widgets: [{ id: 'w1', type: 'status', projectId: pid }] })).body.dashboard;
    assert.equal(d.widgets.length, 1);
    assert.equal((await ben.get(`/api/dashboards/${d.id}`)).status, 200);
    assert.equal((await ben.patch(`/api/dashboards/${d.id}`, { name: 'Mine' })).status, 403);
    assert.ok([403, 404].includes((await outsider.get(`/api/dashboards/${d.id}`)).status));
  });

  test('sample space is filled in', async () => {
    const r = await ava.post(`/api/w/${wid}/projects/sample`);
    assert.equal(r.status, 200);
    assert.ok(r.body.project.itemCount >= 10);
    const items = (await ava.get(`/api/projects/${r.body.project.id}/items`)).body.items;
    assert.ok(items.some((i: any) => i.type === 'epic' && i.childCount > 0));
  });
});

describe('ask parser', () => {
  const people = [{ id: 'U1', names: ['ava', 'Ava Okafor'] }, { id: 'U2', names: ['ben', 'Ben Lindqvist'] }];
  test('understands people, status, priority, type, dates and leftover text', () => {
    let r = parseAsk('my high priority bugs in review', 'U1', people);
    assert.deepEqual(r.query.assignee, ['U1']);
    assert.deepEqual(r.query.priority, ['high']);
    assert.deepEqual(r.query.type, ['bug']);
    assert.deepEqual(r.query.status, ['in_review']);
    r = parseAsk('unassigned stories due this week', 'U1', people);
    assert.deepEqual(r.query.assignee, ['none']);
    assert.deepEqual(r.query.type, ['story']);
    assert.ok(r.query.dueAfter && r.query.dueBefore);
    r = parseAsk('open tasks assigned to ben about invoices', 'U1', people);
    assert.deepEqual(r.query.assignee, ['U2']);
    assert.deepEqual(r.query.notStatus, ['done']);
    assert.equal(r.query.text, 'about invoices');
    r = parseAsk('template overdue', 'U1', people);
    assert.equal(r.query.overdue, true);
    assert.equal(r.query.text, 'template', '"late" inside a word is not a keyword');
  });
});
