/** Copy for the Fellowship landing page: a community home, written short and benefit-first.
 *  Every claim describes a real Fellowship feature. Words wrapped in *asterisks* render as italic serif accents. */

export const HERO = {
  title: ['Bring your whole', '*community* together'],
  cta: 'Start your community',
  worksOn: ['Web', 'Desktop', 'Phone'],
};

export const STATEMENT =
  'Fellowship is where your community lives. Channels for every topic, huddles for quick catch-ups, canvases for the things worth keeping, and workflows that welcome every new member the moment they arrive.';

export interface FeatureScene {
  key: 'talk' | 'routines' | 'projects' | 'huddles';
  title: string;
  body: string;
  pills?: string[];
  cta: string;
}

export const FEATURES: FeatureScene[] = [
  { key: 'talk', title: 'Conversations, *organized*', pills: ['Channels', 'Direct messages', 'Threads'],
    body: 'A channel for every topic, a DM for every quick question, and threads that keep side conversations out of the way. Everyone finds what they need without scrolling for it.', cta: 'Explore messaging' },
  { key: 'routines', title: 'A community that *runs itself*',
    body: 'Welcome new members, collect sign-ups, route requests for approval and post reminders on a schedule. Workflows handle the routine so people can focus on each other.', cta: 'Explore workflows' },
  { key: 'projects', title: 'Plans *everyone* can see',
    body: 'Turn ideas from the conversation into work items, move them across a board, and share any of them back into a channel as a live card.', cta: 'Explore projects' },
  { key: 'huddles', title: 'Talk face to face, *instantly*',
    body: 'Jump into a huddle from any channel. Voice first, camera and screen share when you need them, and a summary lands in the thread when you wrap up.', cta: 'Start a huddle' },
];

export const INTEGRATIONS = {
  title: 'Connect the tools you *already love*',
  body: 'Bots, incoming webhooks, slash commands and signed event subscriptions bring every update into the conversation, where your community can react to it.',
  cta: 'Explore apps',
};

export const TEMPLATES = [
  { title: 'Welcome new members', body: 'Greet people as they join and DM them the house rules and links.', kind: 'Workflow' },
  { title: 'Weekly check-in', body: 'Ask everyone how their week went with a short form every Monday.', kind: 'Workflow' },
  { title: 'Event sign-up', body: 'Collect RSVPs, then post the final list to the channel.', kind: 'Workflow' },
  { title: 'Report a problem', body: 'Members report issues; serious ones open their own channel.', kind: 'Workflow' },
  { title: 'Meeting notes', body: 'Agenda, decisions and follow-ups in one shared canvas.', kind: 'Canvas' },
  { title: 'Community guide', body: 'Goals, roles and how things work, kept up to date together.', kind: 'Canvas' },
  { title: 'Monthly update', body: 'Wins, plans and shout-outs, written together and shared.', kind: 'Canvas' },
  { title: 'Release notifier', body: 'A bot that posts new releases from an incoming webhook.', kind: 'App' },
];

/** Example scenarios (not testimonials): how different communities put Fellowship to work. */
export const USE_CASES = {
  lead: { team: 'Open-source project', text: 'New contributors land in #welcome and get the contributing guide automatically. Issues from the tracker post into #triage, maintainers claim them with a reaction, and release notes go out from a bot.' },
  cards: [
    { team: 'Study group', text: 'A channel per course, huddles before exams, shared notes in a canvas.' },
    { team: 'Creator community', text: 'Members share work in threads; a weekly check-in keeps everyone posting.' },
    { team: 'Startup team', text: 'Deal rooms, deploy alerts and a board for the roadmap, all in one place.' },
    { team: 'Nonprofit', text: 'Volunteers sign up for events with a form and get reminders automatically.' },
    { team: 'Gaming guild', text: 'Voice huddles for raids, polls for scheduling, a channel for every game.' },
    { team: 'Neighbourhood', text: 'Local updates, lost-and-found and meetups, without a dozen group chats.' },
  ],
};

export const FOOTER = [
  { title: 'Product', links: ['Messaging', 'Huddles', 'Canvases', 'Workflows', 'Projects'] },
  { title: 'Explore', links: ['Apps & bots', 'Templates', 'Search', 'Security'] },
  { title: 'Company', links: ['About', 'Docs', 'Contact'] },
];
