const TOKEN_KEY = 'rackpanel:authToken';

type VoidListener = () => void;

const unauthorizedListeners: VoidListener[] = [];
const pinLockedListeners: VoidListener[] = [];

export function getAuthToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token: string): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function clearAuthToken(): void {
  setAuthToken('');
}

export function onUnauthorized(fn: VoidListener): () => void {
  unauthorizedListeners.push(fn);
  return () => {
    const idx = unauthorizedListeners.indexOf(fn);
    if (idx !== -1) unauthorizedListeners.splice(idx, 1);
  };
}

export function notifyUnauthorized(): void {
  for (let i = 0; i < unauthorizedListeners.length; i++) {
    try {
      unauthorizedListeners[i]();
    } catch {
      // ignore
    }
  }
}

export function onPinLocked(fn: VoidListener): () => void {
  pinLockedListeners.push(fn);
  return () => {
    const idx = pinLockedListeners.indexOf(fn);
    if (idx !== -1) pinLockedListeners.splice(idx, 1);
  };
}

export function notifyPinLocked(): void {
  for (let i = 0; i < pinLockedListeners.length; i++) {
    try {
      pinLockedListeners[i]();
    } catch {
      // ignore
    }
  }
}
