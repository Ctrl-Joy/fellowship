import type { Db } from '../../db';
import { forbidden, notFound } from '../../errors';

export interface ConversationRow {
  id: string;
  workspace_id: string;
  kind: 'channel' | 'dm' | 'group_dm' | 'self';
  name: string | null;
  topic: string;
  description: string;
  is_private: number;
  is_archived: number;
  created_by: string | null;
  created_at: number;
  dm_key: string | null;
}

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  joined_at: number;
  deactivated: number;
}

export function createAccess(db: Db) {
  const wsMember = db.prepare(
    'SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND deactivated = 0',
  );
  const convById = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const convMember = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?');

  function workspaceMember(workspaceId: string, userId: string): WorkspaceMemberRow | null {
    return (wsMember.get(workspaceId, userId) as unknown as WorkspaceMemberRow) ?? null;
  }

  /** Throws 404 unless the user is an active member of the workspace. */
  function requireWorkspaceMember(workspaceId: string, userId: string): WorkspaceMemberRow {
    const m = workspaceMember(workspaceId, userId);
    if (!m) throw notFound('Workspace not found');
    return m;
  }

  /** Throws 403 unless the user is an owner or admin of the workspace. */
  function requireWorkspaceAdmin(workspaceId: string, userId: string): WorkspaceMemberRow {
    const m = requireWorkspaceMember(workspaceId, userId);
    if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('Admins only');
    return m;
  }

  function getConversation(conversationId: string): ConversationRow | null {
    return (convById.get(conversationId) as unknown as ConversationRow) ?? null;
  }

  function isConversationMember(conversationId: string, userId: string): boolean {
    return !!convMember.get(conversationId, userId);
  }

  /**
   * Read access: members always; any workspace member may read a public channel.
   * Throws 404 (unknown / other workspace) or 403 (private, not a member).
   */
  function requireConversationRead(conversationId: string, userId: string) {
    const conv = getConversation(conversationId);
    if (!conv) throw notFound('Conversation not found');
    const wsm = workspaceMember(conv.workspace_id, userId);
    if (!wsm) throw notFound('Conversation not found');
    const member = isConversationMember(conv.id, userId);
    if (!member && (conv.kind !== 'channel' || conv.is_private)) throw forbidden('Not a member of this conversation');
    return { conv, wsMember: wsm, isMember: member };
  }

  /** Write access: must be a member of the conversation. */
  function requireConversationMember(conversationId: string, userId: string) {
    const r = requireConversationRead(conversationId, userId);
    if (!r.isMember) throw forbidden('Join the channel first');
    return r;
  }

  return {
    workspaceMember, requireWorkspaceMember, requireWorkspaceAdmin,
    getConversation, isConversationMember, requireConversationRead, requireConversationMember,
  };
}

export type Access = ReturnType<typeof createAccess>;
