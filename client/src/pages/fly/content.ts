/** Copy for the Fellowship landing page. Every claim describes a real Fellowship feature. */

export const HERO = {
  title: ['Teams that move', 'as one'],
  cta: 'Start your workspace',
  worksOn: ['Web', 'Desktop', 'Phone'],
};

export const STATEMENT =
  "Fellowship isn't another chat app. It's where your channels, calls, docs, workflows and projects live together, so every conversation turns into decisions and every decision into work that ships.";

export interface FeatureScene {
  key: 'talk' | 'routines' | 'projects' | 'huddles';
  title: string;
  body: string;
  pills?: string[];
  cta: string;
}

export const FEATURES: FeatureScene[] = [
  { key: 'talk', title: 'Talk anywhere in the workspace', pills: ['Channels', 'Direct messages', 'Threads'],
    body: 'Open channels for the whole team, private DMs for quick questions, and threads that keep every side conversation attached to what it answers.', cta: 'Learn more' },
  { key: 'routines', title: 'Work that keeps moving while you sleep',
    body: 'Workflows react to reactions, new members, messages, schedules and webhooks. They collect forms, wait for approvals and pick up exactly where they left off.', cta: 'Explore workflows' },
  { key: 'projects', title: 'Plan the work where you talk about it',
    body: 'Spaces with lists, boards and timelines. Drag a card to Done and share any work item into a channel as a live card.', cta: 'See projects' },
  { key: 'huddles', title: 'Huddle up in one click',
    body: 'Voice first, camera and screen share when you need them. A huddle thread keeps the links, and a summary lands when you leave.', cta: 'Start a huddle' },
];

export const INTEGRATIONS = {
  title: 'Bring your tools into the room',
  body: 'Bots, incoming webhooks, slash commands and signed event subscriptions. Your tools post, listen and react right inside the conversation.',
  cta: 'Explore apps',
};

export const TEMPLATES = [
  { title: 'Welcome new members', body: 'Greet people as they join a channel and DM them the essentials.', kind: 'Workflow' },
  { title: 'Daily stand-up', body: 'Collect yesterday, today and blockers in a form every morning.', kind: 'Workflow' },
  { title: 'Time-off approval', body: 'Request days off, route to a manager, notify on the decision.', kind: 'Workflow' },
  { title: 'Incident report', body: 'Capture severity and open a response channel for severe ones.', kind: 'Workflow' },
  { title: 'Meeting notes', body: 'Agenda, decisions and follow-ups in one shared canvas.', kind: 'Canvas' },
  { title: 'Project brief', body: 'Goals, scope, owners and milestones your team can edit live.', kind: 'Canvas' },
  { title: 'Weekly update', body: 'Wins, risks and next steps, written together every Friday.', kind: 'Canvas' },
  { title: 'Deploy notifier', body: 'A bot that posts builds and releases from an incoming webhook.', kind: 'App' },
];

/** Example scenarios (not customer quotes): how different teams put Fellowship to work. */
export const USE_CASES = {
  lead: { team: 'Support team', text: 'New tickets land in #support from a webhook, the on-call person claims them with a reaction, and a workflow posts the daily recap with how many were resolved.' },
  cards: [
    { team: 'Engineering', text: 'Deploy bot posts every release; incidents open their own channel automatically.' },
    { team: 'Design', text: 'Critiques happen in a huddle, decisions go straight into the project canvas.' },
    { team: 'Operations', text: 'Time-off requests route to managers and come back approved in minutes.' },
    { team: 'Sales', text: 'Deal rooms per customer, with the brief and the board one tab away.' },
    { team: 'People', text: 'Every new hire gets the same welcome, checklist and buddy on day one.' },
    { team: 'Leadership', text: 'Weekly updates written together in a canvas instead of a dozen DMs.' },
  ],
};

export const FOOTER = [
  { title: 'Product', links: ['Messaging', 'Huddles', 'Canvases', 'Workflows', 'Projects'] },
  { title: 'Explore', links: ['Apps & bots', 'Templates', 'Search', 'Security'] },
  { title: 'Company', links: ['About', 'Docs', 'Contact'] },
];
