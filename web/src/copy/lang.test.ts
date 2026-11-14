import {describe, expect, it} from "vitest";
import {currentSearch, queryLang, resolveLang} from "./lang";

describe("resolveLang: ?lang= → saved choice → browser language", () => {
    it("the query wins over a saved choice and the browser", () => {
        expect(resolveLang({stored: "en", search: "?lang=ko", navigatorLang: "en-US"})).toBe("ko");
        expect(resolveLang({stored: "ko", search: "?lang=en", navigatorLang: "ko-KR"})).toBe("en");
        expect(resolveLang({stored: "ko", search: "lang=en", navigatorLang: "ko-KR"})).toBe("en");
    });
    it("a saved choice is used when the query is missing or invalid", () => {
        expect(resolveLang({stored: "en", search: "", navigatorLang: "ko-KR"})).toBe("en");
        expect(resolveLang({stored: "ko", search: "?lang=de", navigatorLang: "en-US"})).toBe("ko");
    });
    it("queryLang returns only valid values", () => {
        expect(queryLang("?x=1&lang=en")).toBe("en");
        expect(queryLang("?lang=fr")).toBeUndefined();
        expect(queryLang("")).toBeUndefined();
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
