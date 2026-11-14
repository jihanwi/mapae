// Minimal Node globals used by the functions (avoids adding @types/node).
declare const process: {env: Record<string, string | undefined>};
