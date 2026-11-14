import {describe, expect, it} from "vitest";
import {currentSearch, resolveLang} from "./lang";

describe("resolveLang: saved choice → ?lang= → browser language", () => {
    it("a saved choice wins over the query and the browser", () => {
        expect(resolveLang({stored: "en", search: "?lang=ko", navigatorLang: "ko-KR"})).toBe("en");
        expect(resolveLang({stored: "ko", search: "?lang=en", navigatorLang: "en-US"})).toBe("ko");
    });
    it("the query is used when nothing valid is saved", () => {
        expect(resolveLang({stored: null, search: "?lang=en", navigatorLang: "ko-KR"})).toBe("en");
        expect(resolveLang({stored: "fr", search: "lang=ko", navigatorLang: "en-US"})).toBe("ko");
    });
    it("falls back to the browser language: ko* → ko, anything else → en", () => {
        expect(resolveLang({stored: null, search: "", navigatorLang: "ko-KR"})).toBe("ko");
        expect(resolveLang({stored: null, search: "?lang=de", navigatorLang: "ko"})).toBe("ko");
        expect(resolveLang({stored: null, search: "", navigatorLang: "en-GB"})).toBe("en");
        expect(resolveLang({stored: undefined, search: "", navigatorLang: undefined})).toBe("en");
    });
    it("reads the query from the hash when the router keeps it there", () => {
        expect(currentSearch({search: "", hash: "#/create?lang=en"})).toBe("?lang=en");
        expect(currentSearch({search: "?lang=ko", hash: "#/"})).toBe("?lang=ko");
        expect(currentSearch({search: "", hash: "#/"})).toBe("");
    });
});
