export const isBrowser = (): boolean =>
  typeof globalThis.window !== 'undefined'
