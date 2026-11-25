const KEY = 'apapo.token'
const REFRESH_KEY = 'apapo.refresh'

// Falls back to memory when sessionStorage is missing or blocked (private mode, tests, SSR).
// The session then lasts until the page reloads instead of failing silently.
const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function write(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    memory.set(key, value)
  }
}

function remove(key: string) {
  memory.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    // nothing stored there
  }
}

export const session = {
  get: (): string | null => read(KEY),
  set: (token: string) => write(KEY, token),
  getRefresh: (): string | null => read(REFRESH_KEY),
  setRefresh: (token: string) => write(REFRESH_KEY, token),
  clear: () => {
    remove(KEY)
    remove(REFRESH_KEY)
  },
}
