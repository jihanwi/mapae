import {describe, expect, it} from "vitest";
import {privateKeyToAccount} from "viem/accounts";
import {draftHasContent, emptyDraft, prepareMetaRequest} from "./meta";
import {handlePostMeta, Store} from "../../api/_lib/handler";
import {centerSquare} from "../lib/metaImage";

// Well-known Anvil test key, never used on a real chain.
const dev = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const CURVE = "0x2222222222222222222222222222222222222222" as const;

const store = (): Store => {
    const files = new Map<string, unknown>();
    return {
        getJson: async (p) => (files.has(p) ? JSON.parse(files.get(p) as string) : null),
        exists: async (p) => files.has(p),
        put: async (p, b) => {
            files.set(p, b);
            return {url: `https://blob.example/${p}`};
        },
        list: async () => [...files.keys()],
    };
};

describe("client request matches what the server verifies", () => {
    it("a signed draft (with control characters and padded links) is accepted as is", async () => {
        const issuedAt = new Date().toISOString();
        const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);
        const draft = {
            image: {bytes: webp, type: "image/webp", previewUrl: ""},
            description: "  Hello\nMAPAE\u0007 ",
            links: {x: " https://x.com/mapae ", telegram: "https://t.me/mapae", website: ""},
        };
        const req = await prepareMetaRequest(CURVE, draft, issuedAt);
        expect(req.body.description).toBe("HelloMAPAE");
        const signature = await dev.signMessage({message: req.message});
        const res = await handlePostMeta(
            {...req.body, signature},
            {store: store(), chain: {isCurve: async () => true, devOf: async () => dev.address}, nowMs: Date.now()}
        );
        expect(res.status).toBe(201);
    });
});

describe("draft helpers", () => {
    it("draftHasContent ignores whitespace-only descriptions", () => {
        expect(draftHasContent(emptyDraft())).toBe(false);
        expect(draftHasContent({...emptyDraft(), description: " \n "})).toBe(false);
        expect(draftHasContent({...emptyDraft(), links: {x: "", telegram: "https://t.me/a", website: ""}})).toBe(true);
    });
    it("centerSquare crops the middle", () => {
        expect(centerSquare(1000, 600)).toEqual([200, 0, 600]);
        expect(centerSquare(600, 1001)).toEqual([0, 200, 600]);
        expect(centerSquare(512, 512)).toEqual([0, 0, 512]);
    });
});
