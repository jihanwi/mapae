// Minimal Node globals used by the functions (avoids adding @types/node).
declare const process: {env: Record<string, string | undefined>};

// W-T52: the card reads its fonts and the logo from the deployed files.
declare module "node:fs/promises" {
    export function readFile(path: URL): Promise<Uint8Array>;
}
