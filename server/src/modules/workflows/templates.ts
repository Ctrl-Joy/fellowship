// Starter templates (original Fellowship content). Channel / user ids are left for the builder to fill.
import type { Step, Trigger } from './types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  trigger: Trigger;
  steps: Step[];
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome new members',
    description: 'Greet people when they join a channel and point them at the essentials.',
    emoji: '👋',
    trigger: { type: 'member_joined', channelId: '' },
    steps: [
      {
        id: 'greet', type: 'send_message', name: 'Say hello in the channel',
        config: { target: { kind: 'trigger_channel' }, text: 'Everyone, please welcome {{trigger.user}} to {{trigger.channel}}! 🎉' },
      },
      {
        id: 'tips', type: 'send_message', name: 'Send a private note',
        config: {
          target: { kind: 'trigger_user' },
          text: 'Hi {{trigger.user}}, glad you are here. Pinned messages in {{trigger.channel}} cover how this team works — and feel free to ask anything.',
        },
      },
    ],
  },
  {
    id: 'standup',
    name: 'Daily stand-up form',
    description: 'Every weekday morning, collect yesterday / today / blockers and share them.',
    emoji: '☀️',
    trigger: { type: 'schedule', schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:30' } },
    steps: [
      {
        id: 'form', type: 'send_form', name: 'Stand-up questions',
        config: {
          target: { kind: 'channel', channelId: '' }, title: 'Daily stand-up', intro: 'Take a minute to share your plan for {{now}}.',
          allowMultiple: false, postResponsesTo: 'same', submitLabel: 'Share update',
          fields: [
            { id: 'yesterday', label: 'What did you finish yesterday?', type: 'long_text', required: true },
            { id: 'today', label: 'What are you working on today?', type: 'long_text', required: true },
            { id: 'blockers', label: 'Anything in your way?', type: 'short_text', required: false },
          ],
        },
      },
    ],
  },
  {
    id: 'timeoff',
    name: 'Time-off approval',
    description: 'Request time off, have a manager approve it, and notify the requester either way.',
    emoji: '🌴',
    trigger: { type: 'manual', channelIds: [] },
    steps: [
      {
        id: 'request', type: 'send_form', name: 'Time-off details',
        config: {
          target: { kind: 'trigger_user' }, title: 'Request time off', intro: '', allowMultiple: false, submitLabel: 'Send request',
          fields: [
            { id: 'start', label: 'First day off', type: 'date', required: true },
            { id: 'end', label: 'Last day off', type: 'date', required: true },
            { id: 'kind', label: 'Type', type: 'select', required: true, options: ['Vacation', 'Sick leave', 'Personal'] },
            { id: 'manager', label: 'Who approves?', type: 'user', required: true },
          ],
        },
      },
      {
        id: 'approval', type: 'request_approval', name: 'Manager approval',
        config: {
          approver: { kind: 'variable', value: '{{steps.request.manager}}' },
          text: '{{trigger.user}} would like {{steps.request.kind}} from {{steps.request.start}} to {{steps.request.end}}.',
        },
        then: [{
          id: 'approvedMsg', type: 'send_message', name: 'Tell the requester',
          config: { target: { kind: 'trigger_user' }, text: '✅ Your time off ({{steps.request.start}} – {{steps.request.end}}) was approved by {{steps.approval.decidedBy}}.' },
        }],
        else: [{
          id: 'deniedMsg', type: 'send_message', name: 'Tell the requester',
          config: { target: { kind: 'trigger_user' }, text: 'Your time-off request was not approved. Note from {{steps.approval.decidedBy}}: {{steps.approval.note}}' },
        }],
      },
    ],
  },
  {
    id: 'incident',
    name: 'Incident report',
    description: 'React with 🚨 on a message to open an incident form, then spin up a response channel for severe issues.',
    emoji: '🚨',
    trigger: { type: 'reaction', channelId: '', emoji: '🚨' },
    steps: [
      {
        id: 'report', type: 'send_form', name: 'Incident details',
        config: {
          target: { kind: 'trigger_user' }, title: 'Report an incident', intro: 'Flagged message: "{{trigger.message.text}}"',
          allowMultiple: false, submitLabel: 'File report',
          fields: [
            { id: 'summary', label: 'Summary', type: 'short_text', required: true },
            { id: 'severity', label: 'Severity', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
            { id: 'details', label: 'What happened?', type: 'long_text', required: false },
          ],
        },
      },
      {
        id: 'severe', type: 'branch', name: 'Is it severe?',
        config: {
          match: 'any',
          groups: [{ match: 'any', conditions: [
            { left: '{{steps.report.severity}}', op: 'equals', right: 'High' },
            { left: '{{steps.report.severity}}', op: 'equals', right: 'Critical' },
          ] }],
        },
        then: [
          { id: 'room', type: 'create_channel', name: 'Open a response channel', config: { name: 'incident-{{trigger.message.id}}', isPrivate: false, topic: '{{steps.report.summary}}' } },
          { id: 'invite', type: 'invite_to_channel', name: 'Bring in the reporter', config: { channelId: '{{steps.room.channel}}', userIds: ['{{trigger.user}}'] } },
          { id: 'kickoff', type: 'send_message', name: 'Kick off', config: { target: { kind: 'channel', channelId: '{{steps.room.channel}}' }, text: '🚨 *{{steps.report.severity}}* incident reported by {{trigger.user}}: {{steps.report.summary}}\n{{steps.report.details}}' } },
        ],
        else: [
          { id: 'ack', type: 'send_message', name: 'Acknowledge', config: { target: { kind: 'trigger_channel' }, text: 'Thanks {{trigger.user}} — logged a {{steps.report.severity}} incident: {{steps.report.summary}}' } },
        ],
      },
    ],
  },
];
