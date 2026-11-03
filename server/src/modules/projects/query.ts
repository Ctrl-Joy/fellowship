/** Work-item list filters, plus the "Ask" parser that turns plain English into those filters. */

export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest', 'none'] as const;
export const TYPES = ['epic', 'story', 'task', 'bug', 'subtask'] as const;

export interface ItemQuery {
  text?: string;
  assignee?: string[]; // user ids; 'none' = unassigned
  status?: string[];
  notStatus?: string[];
  type?: string[];
  priority?: string[];
  parent?: string; // item id, or 'none' for top-level
  dueBefore?: string; // YYYY-MM-DD inclusive
  dueAfter?: string;
  overdue?: boolean;
  createdSince?: number;
  updatedSince?: number;
}

const WORD_STATUS: [RegExp, string][] = [
  [/\b(to ?do|not started|backlog)\b/, 'todo'],
  [/\bin ?progress|\bdoing\b|\bstarted\b/, 'in_progress'],
  [/\bin ?review|\breview(ing)?\b/, 'in_review'],
  [/\b(done|finished|completed|closed|resolved)\b/, 'done'],
];
const WORD_TYPE: [RegExp, string][] = [
  [/\bbugs?\b/, 'bug'], [/\bepics?\b/, 'epic'], [/\bstor(y|ies)\b/, 'story'],
  [/\bsub-?tasks?\b/, 'subtask'], [/\btasks?\b/, 'task'],
];
const STOP = new Set(['show', 'me', 'all', 'the', 'a', 'an', 'items', 'item', 'work', 'issues', 'issue', 'that', 'are', 'is', 'with',
  'which', 'what', 'list', 'find', 'priority', 'status', 'in', 'of', 'and', 'or', 'to', 'for', 'my', 'mine', 'i', 'have', 'any']);

export interface AskResult { query: ItemQuery; explanation: string[] }

/**
 * Rule-based natural-language parser: "my high priority bugs in review", "overdue tasks assigned to ben",
 * "unassigned stories due this week". Words it doesn't understand become a text search.
 */
export function parseAsk(input: string, meId: string, members: { id: string; names: string[] }[], today = new Date()): AskResult {
  let s = ` ${input.toLowerCase().replace(/[?.!,]/g, ' ')} `;
  const q: ItemQuery = {};
  const why: string[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const take = (re: RegExp) => { const hit = re.test(s); if (hit) s = s.replace(re, ' '); return hit; };

  if (take(/\bunassigned\b|\bno assignee\b|\bnobody\b/)) { q.assignee = ['none']; why.push('unassigned'); }
  const toName = /\b(?:assigned to|owned by|for)\s+@?([a-z][\w.-]*)/.exec(s);
  if (toName) {
    const m = members.find((x) => x.names.some((n) => n.toLowerCase().startsWith(toName[1])));
    if (m) { q.assignee = [m.id]; why.push(`assigned to ${toName[1]}`); s = s.replace(toName[0], ' '); }
  }
  if (!q.assignee && take(/\b(my|mine|assigned to me|i own)\b/)) { q.assignee = [meId]; why.push('assigned to you'); }

  if (take(/\b(open|not done|unresolved|remaining|outstanding)\b/)) { q.notStatus = ['done']; why.push('not done'); }
  for (const [re, st] of WORD_STATUS) if (take(re)) { (q.status ??= []).push(st); why.push(`status ${st.replace('_', ' ')}`); }

  for (const p of ['highest', 'lowest', 'high', 'medium', 'low'] as const) {
    if (take(new RegExp(`\\b${p}\\b`))) { (q.priority ??= []).push(p); why.push(`${p} priority`); }
  }
  if (take(/\b(urgent|critical|blocker)\b/)) { (q.priority ??= []).push('highest', 'high'); why.push('high or highest priority'); }

  for (const [re, t] of WORD_TYPE) if (take(re)) { (q.type ??= []).push(t); why.push(`${t}s`); }

  if (take(/\b(overdue|late|past due)\b/)) { q.overdue = true; why.push('overdue'); }
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  if (take(/\bdue (this week|soon|in the next 7 days)\b/)) { q.dueAfter = iso(today); q.dueBefore = iso(weekEnd); why.push('due in the next 7 days'); }
  if (take(/\bdue today\b/)) { q.dueAfter = q.dueBefore = iso(today); why.push('due today'); }
  const day = 86_400_000;
  if (take(/\bcreated (today)\b/)) { q.createdSince = today.getTime() - day; why.push('created in the last day'); }
  if (take(/\b(created|new) (this week|recently|lately)\b/)) { q.createdSince = today.getTime() - 7 * day; why.push('created in the last 7 days'); }
  if (take(/\bupdated (today|this week|recently)\b/)) { q.updatedSince = today.getTime() - 7 * day; why.push('updated in the last 7 days'); }

  const rest = s.split(/\s+/).filter((w) => w && !STOP.has(w));
  if (rest.length) { q.text = rest.join(' '); why.push(`matching "${q.text}"`); }
  return { query: q, explanation: why };
}

/** Build the WHERE clause (on alias `i`) for a query. */
export function whereFor(q: ItemQuery, params: (string | number)[]): string {
  const w: string[] = ['i.deleted_at IS NULL'];
  const inList = (col: string, vals: string[]) => {
    const real = vals.filter((v) => v !== 'none');
    const parts: string[] = [];
    if (real.length) { parts.push(`${col} IN (${real.map(() => '?').join(',')})`); params.push(...real); }
    if (vals.includes('none')) parts.push(`${col} IS NULL`);
    if (parts.length) w.push(`(${parts.join(' OR ')})`);
  };
  if (q.assignee?.length) inList('i.assignee_id', q.assignee);
  if (q.status?.length) { w.push(`i.status IN (${q.status.map(() => '?').join(',')})`); params.push(...q.status); }
  if (q.notStatus?.length) { w.push(`i.status NOT IN (${q.notStatus.map(() => '?').join(',')})`); params.push(...q.notStatus); }
  if (q.type?.length) { w.push(`i.type IN (${q.type.map(() => '?').join(',')})`); params.push(...q.type); }
  if (q.priority?.length) { w.push(`i.priority IN (${q.priority.map(() => '?').join(',')})`); params.push(...q.priority); }
  if (q.parent === 'none') w.push('i.parent_id IS NULL');
  else if (q.parent) { w.push('i.parent_id = ?'); params.push(q.parent); }
  if (q.dueAfter) { w.push('i.due_date >= ?'); params.push(q.dueAfter); }
  if (q.dueBefore) { w.push('i.due_date <= ?'); params.push(q.dueBefore); }
  if (q.overdue) { w.push(`i.due_date < ? AND i.status != 'done'`); params.push(new Date().toISOString().slice(0, 10)); }
  if (q.createdSince) { w.push('i.created_at >= ?'); params.push(q.createdSince); }
  if (q.updatedSince) { w.push('i.updated_at >= ?'); params.push(q.updatedSince); }
  if (q.text) {
    // Matches summary, description, or the item key ("SAM-12").
    w.push(`(i.summary LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR (p.key || '-' || i.number) LIKE ? ESCAPE '\\')`);
    const like = `%${q.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  return w.join(' AND ');
}
