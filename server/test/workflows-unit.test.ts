import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, cronMatches, scheduleMatchesMinute, nextFireAt, scheduleError } from '../src/modules/workflows/cron';
import { render, renderValue, evalCondition, evalBranch, advance, stepAt, stepsBefore } from '../src/modules/workflows/variables';
import { validateDefinition, structuralError } from '../src/modules/workflows/definition';
import { isPrivateAddress } from '../src/modules/workflows/engine';
import { TEMPLATES } from '../src/modules/workflows/templates';
import type { RunContext, Step } from '../src/modules/workflows/types';

const at = (iso: string) => Date.parse(iso);

describe('cron matcher', () => {
  test('parses fields, ranges, steps, lists and names', () => {
    const c = parseCron('*/15 9-17 * * MON-FRI');
    assert.deepEqual([...c.minute.values], [0, 15, 30, 45]);
    assert.deepEqual([...c.hour.values].length, 9);
    assert.deepEqual([...c.dow.values].sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual([...parseCron('0 0 1,15 JAN,jul 7').dow.values], [0], '7 means Sunday');
    assert.deepEqual([...parseCron('0 0 1,15 JAN,jul 7').month.values], [1, 7]);
    assert.deepEqual([...parseCron('5-20/5 * * * *').minute.values], [5, 10, 15, 20]);
  });

  test('rejects malformed expressions', () => {
    for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '*/0 * * * *', 'a * * * *', '5-1 * * * *', '* * * 13 *']) {
      assert.throws(() => parseCron(bad), Error, bad);
    }
  });

  test('matches minutes, honours day-of-month OR day-of-week', () => {
    const c = parseCron('30 9 * * 1');
    assert.equal(cronMatches(c, at('2026-11-02T09:30:00Z')), true, 'Monday 09:30');
    assert.equal(cronMatches(c, at('2026-11-03T09:30:00Z')), false, 'Tuesday');
    assert.equal(cronMatches(c, at('2026-11-02T09:31:00Z')), false);
    const either = parseCron('0 12 1 * 5'); // 1st of month OR Friday
    assert.equal(cronMatches(either, at('2026-11-01T12:00:00Z')), true, 'Sunday the 1st');
    assert.equal(cronMatches(either, at('2026-11-06T12:00:00Z')), true, 'Friday the 6th');
    assert.equal(cronMatches(either, at('2026-11-05T12:00:00Z')), false);
  });

  test('timezone offset shifts local time', () => {
    const c = parseCron('0 9 * * *');
    assert.equal(cronMatches(c, at('2026-11-02T08:00:00Z'), 60), true, '09:00 at UTC+1');
    assert.equal(cronMatches(c, at('2026-11-02T09:00:00Z'), 60), false);
  });

  test('daily / weekly / next fire time / validation', () => {
    assert.equal(scheduleMatchesMinute({ kind: 'daily', time: '07:05' }, at('2026-11-03T07:05:30Z')), true);
    assert.equal(scheduleMatchesMinute({ kind: 'weekly', days: [2], time: '07:05' }, at('2026-11-03T07:05:00Z')), true);
    assert.equal(scheduleMatchesMinute({ kind: 'weekly', days: [1], time: '07:05' }, at('2026-11-03T07:05:00Z')), false);
    assert.equal(nextFireAt({ kind: 'cron', expr: '0 0 * * *' }, at('2026-11-03T10:00:00Z')), at('2026-11-04T00:00:00Z'));
    assert.equal(nextFireAt({ kind: 'once', at: 5 }, 10), null);
    assert.equal(scheduleError({ kind: 'daily', time: '25:00' }), 'Time must be HH:MM (24-hour)');
    assert.equal(scheduleError({ kind: 'weekly', days: [], time: '10:00' }), 'Pick at least one weekday');
    assert.match(scheduleError({ kind: 'cron', expr: 'nope' })!, /5 fields/);
    assert.equal(scheduleError({ kind: 'cron', expr: '0 9 * * 1-5' }), null);
  });
});

describe('variables', () => {
  const ctx: RunContext = {
    trigger: { user: 'U01HZY8Q5K3M7N9P2R4T6', channel: 'C01HZY8Q5K3M7N9P2R4T6', message: { text: 'hello world' }, webhook: { amount: 42, tags: ['a', 'b'] } },
    steps: { form: { kind: 'Vacation', days: '3', picks: ['x', 'y'], blank: '' }, http: { json: { data: { items: [{ name: 'first' }] } } } },
    vars: { greeting: 'hi' },
  };
  const now = at('2026-11-03T10:00:00Z');

  test('renders paths, nested arrays, unknowns and now', () => {
    assert.equal(render('{{vars.greeting}} {{trigger.message.text}}!', ctx, now), 'hi hello world!');
    assert.equal(render('{{steps.http.json.data.items.0.name}}', ctx, now), 'first');
    assert.equal(render('[{{steps.missing.x}}][{{nope}}]', ctx, now), '[][]');
    assert.equal(render('{{ now }}', ctx, now), '2026-11-03T10:00:00.000Z');
    assert.equal(render('{{steps.form.picks}}', ctx, now), 'x, y');
    assert.equal(render('{{trigger.webhook}}', ctx, now), '{"amount":42,"tags":["a","b"]}');
  });

  test('mentions for user and channel ids in message text', () => {
    assert.equal(render('{{trigger.user}} in {{trigger.channel}}', ctx, now, { mentions: true }),
      '<@U01HZY8Q5K3M7N9P2R4T6> in <#C01HZY8Q5K3M7N9P2R4T6>');
    assert.equal(render('{{trigger.user}}', ctx, now), 'U01HZY8Q5K3M7N9P2R4T6', 'raw outside messages');
    assert.equal(render('{{trigger.user}}', ctx, now, { mentions: true, isUser: () => false }), 'U01HZY8Q5K3M7N9P2R4T6');
  });

  test('renderValue keeps raw types for single-variable templates', () => {
    assert.deepEqual(renderValue('{{steps.form.picks}}', ctx, now), ['x', 'y']);
    assert.equal(renderValue('{{trigger.webhook.amount}}', ctx, now), 42);
    assert.equal(renderValue('n={{trigger.webhook.amount}}', ctx, now), 'n=42');
  });

  test('conditions: every operator', () => {
    const c = (left: string, op: any, right?: string) => evalCondition({ left, op, right }, ctx, now);
    assert.equal(c('{{steps.form.kind}}', 'equals', 'vacation'), true, 'case-insensitive');
    assert.equal(c('{{steps.form.kind}}', 'not_equals', 'Sick'), true);
    assert.equal(c('{{trigger.message.text}}', 'contains', 'WORLD'), true);
    assert.equal(c('{{steps.form.picks}}', 'contains', 'y'), true, 'array membership');
    assert.equal(c('{{steps.form.picks}}', 'contains', 'z'), false);
    assert.equal(c('{{steps.form.days}}', 'gt', '2'), true);
    assert.equal(c('{{steps.form.days}}', 'lt', '2'), false);
    assert.equal(c('{{trigger.webhook.amount}}', 'gt', '{{steps.form.days}}'), true, 'variables on both sides');
    assert.equal(c('2026-01-02', 'gt', '2026-01-01'), true, 'dates compare');
    assert.equal(c('abc', 'gt', '1'), false, 'non-numeric never compares');
    assert.equal(c('{{steps.form.blank}}', 'is_empty'), true);
    assert.equal(c('{{steps.nothing.x}}', 'is_empty'), true);
    assert.equal(c('{{steps.form.kind}}', 'not_empty'), true);
  });

  test('AND / OR groups', () => {
    const yes = { left: '1', op: 'equals' as const, right: '1' };
    const no = { left: '1', op: 'equals' as const, right: '2' };
    assert.equal(evalBranch({ match: 'all', groups: [{ match: 'any', conditions: [no, yes] }, { match: 'all', conditions: [yes] }] }, ctx, now), true);
    assert.equal(evalBranch({ match: 'all', groups: [{ match: 'all', conditions: [no, yes] }, { match: 'all', conditions: [yes] }] }, ctx, now), false);
    assert.equal(evalBranch({ match: 'any', groups: [{ match: 'all', conditions: [no] }, { match: 'all', conditions: [yes] }] }, ctx, now), true);
  });
});

describe('step tree navigation', () => {
  const s = (id: string, extra: Partial<Step> = {}): Step => ({ id, type: 'send_message', config: {}, ...extra });
  const tree: Step[] = [
    s('a'),
    s('b', { type: 'branch', then: [s('b1'), s('b2', { type: 'branch', then: [s('b2x')], else: [] })], else: [s('e1')] }),
    s('c'),
  ];

  test('advance walks into arms and back out', () => {
    let c = advance(tree, [{ i: 0 }])!;
    assert.equal(stepAt(tree, c)!.id, 'b');
    c = advance(tree, c, 'then')!;
    assert.equal(stepAt(tree, c)!.id, 'b1');
    c = advance(tree, c)!;
    assert.equal(stepAt(tree, c)!.id, 'b2');
    c = advance(tree, c, 'then')!;
    assert.equal(stepAt(tree, c)!.id, 'b2x');
    c = advance(tree, c)!;
    assert.equal(stepAt(tree, c)!.id, 'c', 'pops two levels');
    assert.equal(advance(tree, c), null, 'done');
    // empty arm skips straight on
    assert.equal(stepAt(tree, advance(tree, [{ i: 1 }, { arm: 'then', i: 1 }], 'else')!)!.id, 'c');
    assert.equal(stepAt(tree, advance(tree, [{ i: 1 }], 'else')!)!.id, 'e1');
  });

  test('stepsBefore only offers guaranteed outputs', () => {
    assert.deepEqual(stepsBefore(tree, 'c'), ['a', 'b']);
    assert.deepEqual(stepsBefore(tree, 'b2x'), ['a', 'b', 'b1', 'b2']);
    assert.deepEqual(stepsBefore(tree, 'e1'), ['a', 'b']);
    assert.equal(stepsBefore(tree, 'zzz'), null);
  });
});

describe('definition validation', () => {
  const env = { channelExists: (id: string) => id === 'C1', userExists: (id: string) => id === 'U1' };

  test('structural errors', () => {
    assert.match(structuralError([{ id: 'a', type: 'end', config: {} }, { id: 'a', type: 'end', config: {} }])!, /Duplicate/);
    assert.match(structuralError([{ id: 'a', type: 'end', config: {}, then: [{ id: 'b', type: 'end', config: {} }] }])!, /cannot contain/);
  });

  test('flags missing config, bad variables and trigger problems', () => {
    const issues = validateDefinition({ type: 'schedule', schedule: { kind: 'daily', time: '09:00' } }, [
      { id: 'm', type: 'send_message', config: { target: { kind: 'trigger_user' }, text: 'Hi {{trigger.user}} {{steps.later.messageId}} {{vars.nope}}' } },
      { id: 'later', type: 'http_request', config: { method: 'GET', url: 'ftp://x' } },
      { id: 'b', type: 'branch', config: { match: 'all', groups: [] } },
    ], env);
    const msgs = issues.map((i) => i.message).join('\n');
    assert.match(msgs, /no person who started it/);
    assert.match(msgs, /\{\{trigger.user\}\} is not available/);
    assert.match(msgs, /hasn't run yet/);
    assert.match(msgs, /set by no earlier step/);
    assert.match(msgs, /Only http/);
    assert.match(msgs, /at least one condition/);
  });

  test('a complete definition passes and form fields become variables', () => {
    const issues = validateDefinition({ type: 'manual' }, [
      { id: 'f', type: 'send_form', config: { target: { kind: 'trigger_user' }, title: 'T', fields: [{ id: 'who', label: 'Who', type: 'user', required: true }] } },
      { id: 'v', type: 'set_variable', config: { name: 'x', value: '{{steps.f.who}}' } },
      { id: 'm', type: 'send_message', config: { target: { kind: 'channel', channelId: 'C1' }, text: '{{vars.x}} {{steps.f.submittedBy}} {{now}}' } },
    ], env);
    assert.deepEqual(issues, []);
  });

  test('templates are structurally valid', () => {
    for (const t of TEMPLATES) assert.equal(structuralError(t.steps), null, t.id);
  });
});

test('private address detection', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});
