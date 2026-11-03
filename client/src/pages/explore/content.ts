/** Content for the footer's /explore pages. Every claim describes something Fellowship actually does. */

export interface ExplorePage {
  group: 'Product' | 'Communities' | 'Resources' | 'Fellowship';
  label: string;
  title: string;
  lead: string;
  points: { title: string; body: string }[];
  /** Optional step list, shown as numbered rows (used for setup guides). */
  steps?: { title: string; body: string; code?: string }[];
  cta?: { label: string; to: string };
}

export const EXPLORE: Record<string, ExplorePage> = {
  channels: {
    group: 'Product', label: 'Channels', title: 'A home for every topic',
    lead: 'Channels keep conversations organised by topic, team or project, so members always know where to post and where to look.',
    points: [
      { title: 'Public and private', body: 'Open channels anyone in the workspace can join, and private ones only invited members can see.' },
      { title: 'Threads', body: 'Reply in a thread to keep side conversations out of the main channel.' },
      { title: 'Direct messages', body: 'One-to-one and small group DMs for quick questions.' },
      { title: 'Reactions and mentions', body: 'React with emoji and @mention people so they get notified.' },
      { title: 'Pins and saved items', body: 'Pin the important messages and save the ones you want to come back to.' },
      { title: 'Search', body: 'Full-text search across messages, with filters for channels and people.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },
  huddles: {
    group: 'Product', label: 'Huddles', title: 'Talk face to face, instantly',
    lead: 'Start a huddle from any channel or DM. Voice first, with camera and screen share when you need them.',
    points: [
      { title: 'One click to start', body: 'No meeting links or scheduling. Anyone in the conversation can join.' },
      { title: 'Video and screen share', body: 'Turn on your camera or share your screen during the huddle.' },
      { title: 'Up to 8 people', body: 'Huddles connect participants directly to each other, for up to eight people at once.' },
      { title: 'See who is talking', body: 'Speaking indicators show who has the floor.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },
  canvases: {
    group: 'Product', label: 'Canvases', title: 'Notes that live beside the conversation',
    lead: 'Canvases are shared documents for meeting notes, guides and plans, edited together in real time.',
    points: [
      { title: 'Edit together', body: 'Everyone sees changes as they are made.' },
      { title: 'Rich blocks', body: 'Headings, lists, checklists, quotes and code blocks.' },
      { title: 'Share anywhere', body: 'Attach a canvas to a channel or share it in any conversation.' },
      { title: 'Templates', body: 'Start from meeting notes, a community guide or a monthly update.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },
  workflows: {
    group: 'Product', label: 'Workflows', title: 'Routine work that runs itself',
    lead: 'Workflows automate the jobs your community repeats, from welcoming new members to collecting sign-ups.',
    points: [
      { title: 'Triggers', body: 'Start when someone joins a channel, on a schedule, from a shortcut or from a webhook.' },
      { title: 'Forms', body: 'Collect answers with a form and post the results where they belong.' },
      { title: 'Approvals', body: 'Route requests to a person and continue once they approve.' },
      { title: 'Messages and reminders', body: 'Post to a channel or DM someone at each step.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },
  projects: {
    group: 'Product', label: 'Projects', title: 'Plans everyone can see',
    lead: 'Projects turn ideas from the conversation into work items your whole community can follow.',
    points: [
      { title: 'Boards and lists', body: 'Move work items across columns, or view them as a list.' },
      { title: 'Work items', body: 'Assignees, priorities, due dates, comments and sub-tasks.' },
      { title: 'Dashboards and filters', body: 'Save filters and build dashboards to see progress at a glance.' },
      { title: 'Share into chat', body: 'Share any work item back into a channel as a live card.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },

  'open-communities': {
    group: 'Communities', label: 'Open communities', title: 'Public spaces anyone can join',
    lead: 'Run an open community where newcomers can browse channels, introduce themselves and find their people.',
    points: [
      { title: 'Browse channels', body: 'Members discover and join public channels on their own.' },
      { title: 'Automatic welcomes', body: 'A workflow greets every new member and shares the house rules.' },
      { title: 'Verified sign-ins', body: 'Every member confirms their email address before they can sign in.' },
      { title: 'Huddles for events', body: 'Host AMAs and meetups in a huddle right from a channel.' },
    ],
    cta: { label: 'Start an open community', to: '/signup' },
  },
  'private-teams': {
    group: 'Communities', label: 'Private teams', title: 'Invite-only spaces for your team',
    lead: 'Keep work conversations, plans and files in a workspace only your team can reach.',
    points: [
      { title: 'Invite-only', body: 'People join by invitation, and private channels stay visible only to their members.' },
      { title: 'Guests', body: 'Bring in visitors and limit them to the channels you choose.' },
      { title: 'Projects and canvases', body: 'Plan the work and keep notes next to the conversation.' },
      { title: 'Your own server', body: 'Self-host Fellowship so your messages never leave your infrastructure.' },
    ],
    cta: { label: 'Start a private team', to: '/signup' },
  },
  'classes-clubs': {
    group: 'Communities', label: 'Classes & clubs', title: 'Made for classes and clubs',
    lead: 'A channel per course or interest, a huddle before every exam or meeting, and notes everyone can find.',
    points: [
      { title: 'A channel per topic', body: 'Separate channels for each course, team or event.' },
      { title: 'Study huddles', body: 'Jump into a voice huddle and share your screen to work through problems.' },
      { title: 'Shared notes', body: 'Keep lecture notes and meeting minutes in a canvas.' },
      { title: 'Event sign-ups', body: 'Collect RSVPs with a workflow form and post the list automatically.' },
    ],
    cta: { label: 'Start your club', to: '/signup' },
  },
  'open-source': {
    group: 'Communities', label: 'Open source', title: 'Home for open-source projects',
    lead: 'Give contributors one place to ask questions, triage issues and follow releases.',
    points: [
      { title: 'Contributor onboarding', body: 'Welcome new contributors and point them to the guide automatically.' },
      { title: 'Release bots', body: 'Post release notes and CI results into channels with incoming webhooks.' },
      { title: 'Triage board', body: 'Track issues and claims on a project board everyone can see.' },
      { title: 'Threads for discussions', body: 'Keep design discussions tidy in threads.' },
    ],
    cta: { label: 'Start your project space', to: '/signup' },
  },

  templates: {
    group: 'Resources', label: 'Templates', title: 'Start with a template',
    lead: 'Ready-made workflows and canvases you can add to a workspace and adjust to fit.',
    points: [
      { title: 'Welcome new members', body: 'Workflow: greet people as they join and DM them the house rules.' },
      { title: 'Weekly check-in', body: 'Workflow: ask everyone how their week went with a short form.' },
      { title: 'Event sign-up', body: 'Workflow: collect RSVPs, then post the final list to the channel.' },
      { title: 'Report a problem', body: 'Workflow: members report issues and they are routed for review.' },
      { title: 'Meeting notes', body: 'Canvas: agenda, decisions and follow-ups in one place.' },
      { title: 'Community guide', body: 'Canvas: goals, roles and how things work, kept up to date together.' },
    ],
    cta: { label: 'Try the templates', to: '/signup' },
  },
  'apps-bots': {
    group: 'Resources', label: 'Apps & bots', title: 'Connect the tools you already use',
    lead: 'Build apps that post into Fellowship and react to what happens in your community.',
    points: [
      { title: 'Bot users', body: 'Each app gets a bot token to read and post messages through the API.' },
      { title: 'Incoming webhooks', body: 'Post into a channel from any service with a single HTTP request.' },
      { title: 'Slash commands', body: 'Add /commands that call your app and reply in the conversation.' },
      { title: 'Signed events', body: 'Subscribe to events, delivered with an HMAC signature you can verify.' },
    ],
    cta: { label: 'Build an app', to: '/signup' },
  },
  'self-hosting': {
    group: 'Resources', label: 'Self-hosting', title: 'Run Fellowship on your own server',
    lead: 'Fellowship is one Node.js app with a SQLite database. Here is how to get it running.',
    points: [],
    steps: [
      { title: 'Install Node.js 24', body: 'Fellowship uses the SQLite support built into Node.js 24.' },
      { title: 'Install dependencies', body: 'From the project folder:', code: 'npm install' },
      { title: 'Configure email', body: 'Add your Brevo settings to a .env file so members can verify their email address. Without a key, emails are printed to the server console instead.', code: 'BREVO_API_KEY=…\nBREVO_SENDER_EMAIL=you@yourdomain.com\nAPP_URL=https://chat.yourdomain.com' },
      { title: 'Start it', body: 'Run the server and web app together:', code: 'npm run dev' },
      { title: 'Build for production', body: 'Type-check the server and build the web app:', code: 'npm run build' },
    ],
    cta: { label: 'Create your account', to: '/signup' },
  },
  docs: {
    group: 'Resources', label: 'Docs', title: 'Documentation',
    lead: 'Guides for running and extending Fellowship. The full documents live in the docs folder of the project.',
    points: [
      { title: 'Self-hosting', body: 'Install, configure and start your own server.' },
      { title: 'Email setup', body: 'Connect Brevo for verification codes and password resets (docs/EMAIL.md).' },
      { title: 'Huddles', body: 'How voice, video and screen share connect participants (docs/HUDDLES.md).' },
      { title: 'Projects', body: 'Boards, work items, dashboards and filters (docs/PROJECTS.md).' },
      { title: 'Apps & bots', body: 'Bot tokens, webhooks, slash commands and signed events.' },
      { title: 'Specification', body: 'The full product and engineering spec (docs/SPEC.md).' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },

  about: {
    group: 'Fellowship', label: 'About', title: 'Where your community gathers',
    lead: 'Fellowship is a place for communities to talk, meet and get things done together, on a server you control.',
    points: [
      { title: 'Built for communities', body: 'Clubs, classes, teams, open-source projects and neighbourhoods.' },
      { title: 'Everything in one place', body: 'Messaging, huddles, canvases, workflows, projects and apps.' },
      { title: 'Yours to run', body: 'Self-host it and keep every message on your own infrastructure.' },
      { title: 'Free to use', body: 'Every feature is available to every workspace.' },
    ],
    cta: { label: 'Start your community', to: '/signup' },
  },
  security: {
    group: 'Fellowship', label: 'Security', title: 'Security',
    lead: 'How Fellowship protects your members and their conversations.',
    points: [
      { title: 'Verified email', body: 'Members must confirm their email address with a code or link before they can sign in.' },
      { title: 'Hashed passwords', body: 'Passwords are stored as salted scrypt hashes, never in plain text.' },
      { title: 'Secure sessions', body: 'Sessions use HTTP-only, same-site cookies that page scripts cannot read.' },
      { title: 'Rate-limited codes', body: 'Verification and sign-in codes expire, and repeated attempts are limited.' },
      { title: 'Signed webhooks', body: 'Event deliveries to apps carry an HMAC signature so receivers can verify them.' },
      { title: 'Your data stays put', body: 'Everything is stored in the SQLite database on your own server.' },
    ],
    cta: { label: 'Create your account', to: '/signup' },
  },
  contact: {
    group: 'Fellowship', label: 'Contact', title: 'Get in touch',
    lead: 'Fellowship runs on servers its communities host themselves, so help comes from the people who run yours.',
    points: [
      { title: 'Questions about a workspace', body: 'Sign in and message the workspace admins directly.' },
      { title: 'Problems signing in', body: 'Use "Forgot password?" or "Email me a sign-in code" on the sign-in page.' },
      { title: 'Running your own server', body: 'See the self-hosting guide and the docs folder in the project.' },
    ],
    cta: { label: 'Sign in', to: '/login' },
  },
};

/** Footer columns, in order, each linking to its /explore pages. */
export const FOOTER_GROUPS = (['Product', 'Communities', 'Resources', 'Fellowship'] as const).map((group) => ({
  title: group,
  links: Object.entries(EXPLORE).filter(([, p]) => p.group === group).map(([slug, p]) => ({ slug, label: p.label })),
}));
