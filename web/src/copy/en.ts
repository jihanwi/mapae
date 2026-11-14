// English dictionary. `satisfies Copy` makes tsc fail if any key of ko.ts is missing.
import {ko, Copy} from "./ko";

export const en = {
    ...ko,
} satisfies Copy;
