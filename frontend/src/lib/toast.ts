export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  timestamp: number;
}

type Listener = (toasts: Toast[]) => void;

let _toasts: Toast[] = [];
let _listeners: Listener[] = [];
let _nextId = 0;

function _notify() {
  _listeners.forEach(fn => fn([..._toasts]));
}

export function showToast(message: string, kind: ToastKind = 'info'): string {
  const id = `toast-${++_nextId}`;
  _toasts.push({ id, message, kind, timestamp: Date.now() });
  _notify();
  // Auto-dismiss after 5s
  setTimeout(() => dismissToast(id), 5000);
  return id;
}

export function dismissToast(id: string): void {
  _toasts = _toasts.filter(t => t.id !== id);
  _notify();
}

export function subscribe(listener: Listener): () => void {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

export function getToasts(): Toast[] {
  return [..._toasts];
}
