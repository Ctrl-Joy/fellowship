import { create } from 'zustand';
import { api } from '../../api';

export interface CommandInfo {
  command: string;
  usage: string;
  description: string;
  builtin: boolean;
  appId: string | null;
  appName: string | null;
  iconEmoji: string | null;
}

interface CommandsState {
  /** Slash commands available in each workspace (built-ins + app commands). */
  byWorkspace: Record<string, CommandInfo[]>;
  load(workspaceId: string): Promise<void>;
}

export const NO_COMMANDS: CommandInfo[] = [];

export const useAppCommands = create<CommandsState>()((set) => ({
  byWorkspace: {},
  async load(workspaceId) {
    const r = await api.get<{ commands: CommandInfo[] }>(`/api/w/${workspaceId}/commands`);
    set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: r.commands } }));
  },
}));

/** Refresh the cached command list (errors are ignored: autocomplete just stays as it was). */
export function loadAppCommands(workspaceId: string) {
  return useAppCommands.getState().load(workspaceId).catch(() => undefined);
}

/** Filter the list for the composer's "/" autocomplete. */
export function commandSuggestions(list: CommandInfo[], query: string): CommandInfo[] {
  const q = query.toLowerCase();
  return list
    .filter((c) => !q || c.command.startsWith(q) || c.command.includes(q))
    .sort((a, b) => Number(b.command.startsWith(q)) - Number(a.command.startsWith(q)) || a.command.localeCompare(b.command))
    .slice(0, 8);
}

/** If the message is a known slash command ("/topic New topic"), split it; otherwise null. */
export function parseKnownCommand(raw: string, list: CommandInfo[]): { name: string; text: string } | null {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(raw.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!list.some((c) => c.command === name)) return null;
  return { name, text: (m[2] ?? '').trim() };
}
