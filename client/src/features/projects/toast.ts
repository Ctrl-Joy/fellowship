import { create } from 'zustand';

/** Small transient notices for the projects area ("BIL-4 was assigned to you"). */
interface ToastState { toasts: { id: number; text: string; href?: string }[]; push(text: string, href?: string): void; dismiss(id: number): void }
let seq = 0;
export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (text, href) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, href }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const showToast = (text: string, href?: string) => useToasts.getState().push(text, href);
