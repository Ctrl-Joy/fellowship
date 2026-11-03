import { api } from '../../api';

export const APP_SCOPES = [
  { id: 'chat:write', label: 'Post and edit its own messages' },
  { id: 'channels:read', label: 'List the channels and DMs it can see' },
  { id: 'channels:join', label: 'Join public channels' },
  { id: 'channels:history', label: 'Read channel history' },
  { id: 'users:read', label: 'Look up people in the workspace' },
  { id: 'reactions:write', label: 'Add reactions' },
] as const;

export const EVENT_TYPE_OPTIONS = [
  { id: 'message.created', label: 'A message is posted in a channel the app is in' },
  { id: 'reaction.added', label: 'A reaction is added' },
  { id: 'member.joined', label: 'Someone joins a channel the app is in' },
  { id: 'conversation.created', label: 'A conversation is created' },
] as const;

export interface AppSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  iconEmoji: string;
  botUserId: string;
  createdBy: string;
  createdAt: number;
  isSystem: boolean;
  hasToken?: boolean;
}

export interface TokenInfo {
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface WebhookInfo {
  id: string;
  conversationId: string;
  channelName: string | null;
  channelKind: string;
  path: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface AppCommandInfo {
  id: string;
  command: string;
  url: string;
  description: string;
  usageHint: string;
  createdAt: number;
}

export interface DeliveryInfo {
  id: string;
  eventId: string;
  eventType: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AppDetail extends AppSummary {
  tokenInfo: TokenInfo | null;
  signingSecret?: string;
  interactivityUrl?: string | null;
  events?: { url: string | null; eventTypes: string[]; deliveries: DeliveryInfo[] };
  webhooks?: WebhookInfo[];
  commands?: AppCommandInfo[];
}

export interface ChannelOption {
  id: string;
  name: string | null;
  kind: string;
  isArchived: boolean;
  isMember: boolean;
}

export const appsApi = {
  list: (wid: string) => api.get<{ apps: AppSummary[] }>(`/api/w/${wid}/apps`).then((r) => r.apps),
  create: (wid: string, body: { name: string; description: string; iconEmoji: string; scopes: string[] }) =>
    api.post<{ app: AppDetail; token: { value: string; scopes: string[] } }>(`/api/w/${wid}/apps`, body),
  detail: (wid: string, aid: string) => api.get<{ app: AppDetail }>(`/api/w/${wid}/apps/${aid}`).then((r) => r.app),
  update: (wid: string, aid: string, body: { name?: string; description?: string; iconEmoji?: string }) =>
    api.patch<{ app: AppDetail }>(`/api/w/${wid}/apps/${aid}`, body).then((r) => r.app),
  remove: (wid: string, aid: string) => api.del(`/api/w/${wid}/apps/${aid}`),
  rotateToken: (wid: string, aid: string, scopes: string[]) =>
    api.post<{ token: { value: string; scopes: string[] } }>(`/api/w/${wid}/apps/${aid}/token`, { scopes }),
  addWebhook: (wid: string, aid: string, conversationId: string) =>
    api.post<{ webhook: WebhookInfo }>(`/api/w/${wid}/apps/${aid}/webhooks`, { conversationId }).then((r) => r.webhook),
  removeWebhook: (wid: string, aid: string, hid: string) => api.del(`/api/w/${wid}/apps/${aid}/webhooks/${hid}`),
  addCommand: (wid: string, aid: string, body: { command: string; url: string; description: string; usageHint: string }) =>
    api.post<{ command: AppCommandInfo }>(`/api/w/${wid}/apps/${aid}/commands`, body).then((r) => r.command),
  removeCommand: (wid: string, aid: string, cid: string) => api.del(`/api/w/${wid}/apps/${aid}/commands/${cid}`),
  setEvents: (wid: string, aid: string, body: { url: string | null; eventTypes: string[] }) =>
    api.put<{ events: AppDetail['events'] }>(`/api/w/${wid}/apps/${aid}/events`, body).then((r) => r.events),
  testEvent: (wid: string, aid: string) => api.post(`/api/w/${wid}/apps/${aid}/events/test`, {}),
  setInteractivity: (wid: string, aid: string, url: string | null) =>
    api.put(`/api/w/${wid}/apps/${aid}/interactivity`, { url }),
  channels: (wid: string) =>
    api.get<{ channels: ChannelOption[] }>(`/api/w/${wid}/channels/browse`).then((r) => r.channels),
};

/** Run a slash command in a conversation (built-in or app-registered). */
export function runSlashCommand(conversationId: string, command: string, text: string) {
  return api.post<{ ok: boolean; kind: 'builtin' | 'app' }>(`/api/conversations/${conversationId}/commands`, { command, text });
}

export function votePoll(messageId: string, optionId: string) {
  return api.post<{ message: any }>(`/api/apps/polls/${messageId}/vote`, { optionId });
}

export function clickAction(messageId: string, actionId: string, value?: string) {
  return api.post(`/api/messages/${messageId}/actions`, { actionId, value });
}

/** Absolute URL for a server path such as a webhook path. */
export function absoluteUrl(path: string) {
  return `${window.location.origin}${path}`;
}
