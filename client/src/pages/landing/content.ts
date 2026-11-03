/** Copy and structure for the Fellowship landing page. Everything here describes real Fellowship features. */

export type SceneKind = 'chat' | 'huddle' | 'canvas' | 'workflow' | 'apps' | 'search' | 'board' | 'admin';

export interface Feature {
  title: string;
  body: string;
  cta: string;
  scene: SceneKind;
}

export interface Category {
  id: string;
  name: string;
  /** Page colour this section blends the background towards. */
  color: string;
  features: Feature[];
  notes: string[];
}

export const TAGLINE = 'Everything your team needs to work as one';

export const STATS: { value: string; label: string }[] = [
  { value: '8', label: 'people per huddle, with voice, video and screen share built in' },
  { value: '6 · 12', label: 'workflow triggers and step types, with branches, forms and approvals' },
  { value: '0', label: 'per-seat fees. Fellowship runs on your own machine' },
];

export const CATEGORIES: Category[] = [
  {
    id: 'messaging', name: 'Messaging', color: '#1B2A9C',
    features: [
      { title: 'Conversations that keep their shape', body: 'Channels, direct and group messages, and threads that stay attached to the message they answer. Unread counts, mentions and drafts follow you everywhere.', cta: 'Open a channel', scene: 'chat' },
      { title: 'Write it once, format it right', body: 'A formatting toolbar, @mentions, #channel links, emoji shortcodes and file drops in one composer. Press ↑ to fix your last message.', cta: 'Try the composer', scene: 'chat' },
    ],
    notes: ['Typing indicators and read cursors arrive live over one connection', 'Pin, save and star conversations', 'Reactions with a searchable emoji picker', 'Edit and delete with full history in threads'],
  },
  {
    id: 'huddles', name: 'Huddles', color: '#0F5E52',
    features: [
      { title: 'Talk it through without scheduling', body: 'Start a huddle from any channel or DM. Audio first, camera and screen share when you need them, and a thread for links shared along the way.', cta: 'Start a huddle', scene: 'huddle' },
    ],
    notes: ['Speaking indicators on every tile', 'Join listen-only when your mic is busy', 'A summary posts when the huddle ends', 'Live huddle badges in the sidebar'],
  },
  {
    id: 'canvases', name: 'Canvases', color: '#7A3B1F',
    features: [
      { title: 'Documents that live next to the conversation', body: 'Every channel gets a canvas. Headings, checklists, code and callouts, edited together with live cursors and no lost keystrokes.', cta: 'Open a canvas', scene: 'canvas' },
    ],
    notes: ['Slash menu and markdown shortcuts', 'Meeting notes, project brief and weekly update templates', 'Share a canvas into any channel as a card', 'Concurrent edits merge block by block'],
  },
  {
    id: 'workflows', name: 'Workflows', color: '#4B2A86',
    features: [
      { title: 'Automate the busywork', body: 'Trigger on a reaction, a new member, a message, a schedule or a webhook. Send messages, collect forms, ask for approvals and branch on the answers.', cta: 'Build a workflow', scene: 'workflow' },
      { title: 'Approvals that wait for people', body: 'Runs pause for forms and approvals, survive restarts and resume exactly where they stopped, with a step-by-step history of every run.', cta: 'See run history', scene: 'workflow' },
    ],
    notes: ['Time-off, stand-up, welcome and incident templates', 'Variables from earlier steps in any field', 'HTTP requests with timeouts and safe defaults', 'Loop guards so workflows never retrigger themselves'],
  },
  {
    id: 'apps', name: 'Apps & bots', color: '#1E5B32',
    features: [
      { title: 'Bring your tools into the room', body: 'Create a bot in a minute. Post with incoming webhooks, answer slash commands, subscribe to events and add buttons people can click.', cta: 'Create an app', scene: 'apps' },
    ],
    notes: ['/poll, /remind, /topic, /invite and more built in', 'Signed event deliveries with retries', 'Ephemeral replies only the sender sees', 'Bot tokens are shown once and stored hashed'],
  },
  {
    id: 'search', name: 'Search', color: '#26324D',
    features: [
      { title: 'Find the message, not just the word', body: 'Full-text search across messages and files with in:, from:, has:, before: and after: filters. Jump straight to the message, even inside a thread.', cta: 'Search Fellowship', scene: 'search' },
    ],
    notes: ['Private channels and DMs stay private in results', 'Recent searches and filter suggestions', 'File names are searchable too', 'Results ranked by relevance, then recency'],
  },
  {
    id: 'projects', name: 'Projects', color: '#8C1F3D',
    features: [
      { title: 'Plan the work where you talk about it', body: 'Spaces with lists, boards and timelines. Drag cards across columns, track epics, and share any work item into a channel as a live card.', cta: 'Open a space', scene: 'board' },
    ],
    notes: ['Summary charts for status, priority and workload', 'Forms that turn requests into work items', 'Timeline with weeks, months and quarters', 'Ask in plain words: "my overdue bugs"'],
  },
  {
    id: 'admin', name: 'Admin & security', color: '#2E2A26',
    features: [
      { title: 'Yours to run', body: 'Fellowship runs on your own machine with nothing but Node. Invite by link, set roles, archive channels and keep every byte of data in your own database.', cta: 'Invite your team', scene: 'admin' },
    ],
    notes: ['Owner, admin, member and guest roles', 'Session cookies, hashed passwords and tokens', 'Membership checked on every request', 'Export-friendly SQLite storage'],
  },
];

/** Starting page colour (the hero), before any section has scrolled in. */
export const START_COLOR = '#051DAA';
