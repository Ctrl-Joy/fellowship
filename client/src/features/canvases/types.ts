export type BlockType =
  | 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'code' | 'divider' | 'callout';

export interface Block {
  id: string;
  position: string;
  type: BlockType;
  text: string;
  checked: boolean;
  version: number;
  updatedBy?: string | null;
  updatedAt?: number;
}

export type CanvasRole = 'owner' | 'editor' | 'viewer';

export interface Canvas {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  title: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
  isTemplate: boolean;
  role?: CanvasRole | null;
}

export interface Viewer { userId: string; blockId: string | null }

export interface CanvasPayload {
  canvas: Canvas;
  blocks: Block[];
  access: { role: CanvasRole; canEdit: boolean; canManage: boolean };
  sharedWith: { userId: string; role: 'viewer' | 'editor' }[];
  sharedChannels: { conversationId: string; role: 'viewer' | 'editor' }[];
  viewers: Viewer[];
}

export type Op =
  | { op: 'insert'; blockId: string; position?: string; afterId?: string | null; type: BlockType; text: string; checked: boolean }
  | { op: 'update'; blockId: string; baseVersion: number; type?: BlockType; text?: string; checked?: boolean }
  | { op: 'delete'; blockId: string; baseVersion?: number }
  | { op: 'move'; blockId: string; baseVersion: number; position?: string; afterId?: string | null };

export interface OpResult {
  op: Op['op'];
  blockId: string;
  status: 'ok' | 'noop' | 'conflict' | 'gone' | 'error';
  block?: Block;
  conflictFields?: string[];
  error?: string;
}

export type AppliedOp = { op: 'insert' | 'update' | 'move'; block: Block } | { op: 'delete'; blockId: string };

export interface Template { id: string; title: string; description: string; builtin: boolean }

export const BLOCK_TYPES: { type: BlockType; label: string; hint: string; icon: string; keys: string }[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', icon: '¶', keys: 'text paragraph plain' },
  { type: 'h1', label: 'Heading 1', hint: 'Big section title  (# )', icon: 'H1', keys: 'h1 heading title' },
  { type: 'h2', label: 'Heading 2', hint: 'Medium heading  (## )', icon: 'H2', keys: 'h2 heading subtitle' },
  { type: 'h3', label: 'Heading 3', hint: 'Small heading  (### )', icon: 'H3', keys: 'h3 heading' },
  { type: 'bullet', label: 'Bulleted list', hint: 'Simple list  (- )', icon: '•', keys: 'bullet list ul unordered' },
  { type: 'numbered', label: 'Numbered list', hint: 'Ordered steps  (1. )', icon: '1.', keys: 'numbered list ol ordered' },
  { type: 'todo', label: 'Checklist', hint: 'Track tasks  ([] )', icon: '☐', keys: 'todo checklist task check' },
  { type: 'quote', label: 'Quote', hint: 'Call out words  (> )', icon: '❝', keys: 'quote blockquote' },
  { type: 'callout', label: 'Callout', hint: 'Highlighted note', icon: '✦', keys: 'callout note info highlight' },
  { type: 'code', label: 'Code', hint: 'Monospaced block  (```)', icon: '</>', keys: 'code snippet pre' },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule  (---)', icon: '—', keys: 'divider hr rule line separator' },
];
