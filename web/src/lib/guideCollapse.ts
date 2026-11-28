// W-T75: the list's "how an offering works" band remembers being hidden in localStorage. Any
// storage failure (private mode, blocked storage, no window) reads as "shown" and is logged.
export const GUIDE_COLLAPSED_KEY = "mapae.offeringGuide.collapsed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): StorageLike | null => (typeof window === "undefined" ? null : window.localStorage);

export function readGuideCollapsed(storage: () => StorageLike | null = defaultStorage): boolean {
    try {
        return storage()?.getItem(GUIDE_COLLAPSED_KEY) === "1";
    } catch (e) {
        console.warn("offering guide: collapsed state not read; showing the band", e);
        return false;
    }
}

export function writeGuideCollapsed(collapsed: boolean, storage: () => StorageLike | null = defaultStorage): void {
    try {
        storage()?.setItem(GUIDE_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch (e) {
        console.warn("offering guide: collapsed state not saved", e);
    }
}
