import { create } from 'zustand';

export type Theme = 'light' | 'dark';

/** What the right-hand panel shows. Features may add kinds additively. */
export type RightPanel =
  | { kind: 'thread'; conversationId: string; rootId: string }
  | { kind: 'details'; conversationId: string; tab?: 'about' | 'members' | 'settings' }
  | { kind: 'profile'; userId: string }
  | { kind: 'custom'; key: string; props?: Record<string, unknown> }
  | null;

export type Modal =
  | { kind: 'createChannel' }
  | { kind: 'newMessage' }
  | { kind: 'quickSwitcher' }
  | { kind: 'status' }
  | { kind: 'notificationPrefs'; conversationId?: string }
  | { kind: 'custom'; key: string; props?: Record<string, unknown> }
  | null;

interface UiState {
  theme: Theme;
  rightPanel: RightPanel;
  modal: Modal;
  setTheme(t: Theme): void;
  toggleTheme(): void;
  openRightPanel(p: RightPanel): void;
  closeRightPanel(): void;
  openModal(m: Modal): void;
  closeModal(): void;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('fs:theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

export const useUi = create<UiState>()((set, get) => ({
  theme: initialTheme(),
  rightPanel: null,
  modal: null,
  setTheme: (theme) => {
    try { localStorage.setItem('fs:theme', theme); } catch { /* ignore */ }
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  openRightPanel: (rightPanel) => set({ rightPanel }),
  closeRightPanel: () => set({ rightPanel: null }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
}));
