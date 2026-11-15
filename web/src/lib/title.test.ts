import {describe, expect, it} from "vitest";
import {DEFAULT_TITLE, titleOf} from "./title";
import {ko} from "../copy/ko";
import {en} from "../copy/en";

describe("tab titles", () => {
    it("formats screen titles", () => {
        expect(DEFAULT_TITLE).toBe("MAPAE");
        expect(titleOf("Horse (PRI)")).toBe("Horse (PRI) | MAPAE");
        expect(`MAPAE | ${ko.homeRows.tagline}`).toBe("MAPAE | 모두가 같은 출발선에서 시작하는 런치패드");
        expect(`MAPAE | ${en.homeRows.tagline}`).toBe("MAPAE | Every launch starts from the same line.");
        expect(titleOf(ko.create.title)).toBe("토큰 발행 | MAPAE");
        expect(titleOf(en.create.title)).toBe("Launch a token | MAPAE");
    });
});
