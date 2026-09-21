'use client';

import { useSyncExternalStore } from 'react';

/**
 * Presentation mode is a presenter preference, not application state, so it
 * lives in localStorage and is mirrored onto <html data-presentation> for the
 * few purely visual CSS rules that key off it.
 */
const KEY = 'ha.presentationMode';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function paint(on: boolean) {
  document.documentElement.dataset.presentation = on ? 'on' : 'off';
}

export function setPresentationMode(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private browsing — the toggle still works for this page view */
  }
  paint(on);
  listeners.forEach((l) => l());
}

/** Re-applies the stored value after a reload; call once from the presenter bar. */
export function syncPresentationMode() {
  paint(read());
}

export function usePresentationMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      window.addEventListener('storage', onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onChange);
      };
    },
    read,
    () => false,
  );
}
