// Browser tab title per screen. Pages call useTitle; leaving the page restores DEFAULT_TITLE.
import {useEffect} from "react";

export const DEFAULT_TITLE = "MAPAE";

/** "{name} ({symbol}) | MAPAE" style helper: `${part} | MAPAE`. */
export const titleOf = (part: string): string => `${part} | ${DEFAULT_TITLE}`;

/** Sets document.title while mounted (null = leave it to a child). Restores the default on leave. */
export function useTitle(title: string | null): void {
    useEffect(() => {
        if (title === null) return;
        document.title = title;
        return () => {
            document.title = DEFAULT_TITLE;
        };
    }, [title]);
}
