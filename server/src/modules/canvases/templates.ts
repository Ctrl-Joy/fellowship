// Built-in canvas templates (original Fellowship content).

export type BlockType =
  | 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'code' | 'divider' | 'callout';

export const BLOCK_TYPES: BlockType[] = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'todo', 'quote', 'code', 'divider', 'callout'];

export interface TemplateBlock { type: BlockType; text?: string; checked?: boolean }
export interface BuiltinTemplate { id: string; title: string; description: string; blocks: TemplateBlock[] }

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'meeting-notes',
    title: 'Meeting notes',
    description: 'Agenda, decisions and follow-ups in one place.',
    blocks: [
      { type: 'h1', text: 'Meeting notes' },
      { type: 'paragraph', text: 'When: ·  Facilitator: ·  Scribe:' },
      { type: 'h2', text: 'Who joined' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Agenda' },
      { type: 'numbered', text: 'Quick round of wins since last time' },
      { type: 'numbered', text: 'Topics to talk through' },
      { type: 'numbered', text: 'Anything else' },
      { type: 'h2', text: 'What we decided' },
      { type: 'callout', text: 'Write each decision as one sentence, plus the reason we made it.' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Follow-ups' },
      { type: 'todo', text: 'Who · what · by when' },
      { type: 'todo', text: '' },
    ],
  },
  {
    id: 'project-brief',
    title: 'Project brief',
    description: 'Frame the problem, the goal and the plan before you start.',
    blocks: [
      { type: 'h1', text: 'Project brief' },
      { type: 'callout', text: 'In one sentence: what are we building, and for whom?' },
      { type: 'h2', text: 'The problem' },
      { type: 'paragraph', text: 'Describe what is hard or broken today and how we know.' },
      { type: 'h2', text: 'What success looks like' },
      { type: 'bullet', text: 'A measurable outcome' },
      { type: 'bullet', text: 'Another measurable outcome' },
      { type: 'h2', text: 'Not in this project' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Milestones' },
      { type: 'todo', text: 'Kick-off and scope agreed' },
      { type: 'todo', text: 'First version in front of people' },
      { type: 'todo', text: 'Launch' },
      { type: 'h2', text: 'People' },
      { type: 'paragraph', text: 'Lead: ·  Contributors: ·  Reviewers:' },
      { type: 'h2', text: 'Risks and open questions' },
      { type: 'quote', text: 'What could surprise us, and what do we still need to learn?' },
    ],
  },
  {
    id: 'weekly-update',
    title: 'Weekly update',
    description: 'Share progress, blockers and next steps with the team.',
    blocks: [
      { type: 'h1', text: 'Weekly update' },
      { type: 'paragraph', text: 'Week of …' },
      { type: 'h2', text: 'Highlights' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Progress on this cycle’s goals' },
      { type: 'todo', text: 'Goal one', checked: true },
      { type: 'todo', text: 'Goal two' },
      { type: 'h2', text: 'Stuck on' },
      { type: 'bullet', text: '' },
      { type: 'h2', text: 'Coming up next week' },
      { type: 'bullet', text: '' },
      { type: 'divider' },
      { type: 'paragraph', text: 'Questions or ideas? Reply in the channel.' },
    ],
  },
];
