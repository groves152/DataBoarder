import { create } from "zustand";

// Short notices in the corner (a session restored, a job finished), each with
// an optional action button. They go away on their own.
export interface Toast {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.tone === "error" ? 12000 : 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Outside React (stores, callbacks). */
export const toast = (t: Omit<Toast, "id">) => useToastStore.getState().push(t);
