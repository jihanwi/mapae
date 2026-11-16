// Redeem tab visibility (decision 55): the "리딤" sub tab shows only when some offering in the list
// has redeem items or a sponsorship contract. Before the reads finish it stays hidden; when a read
// fails it shows (a failure never hides an existing feature). /redeem itself always works.

export type RedeemReads =
    | {status: "loading"}
    | {status: "error"}
    | {
          status: "done";
          /** offerings with a nonzero sponsorshipOf */
          sponsors: number;
          /** RedeemableCreated count over every redeem manager; undefined while loading */
          items: number | undefined;
          itemsError: boolean;
      };

export function redeemTabVisible(r: RedeemReads): boolean {
    if (r.status === "loading") return false;
    if (r.status === "error") return true;
    if (r.sponsors > 0) return true;
    if (r.itemsError) return true;
    if (r.items === undefined) return false;
    return r.items > 0;
}

/** What the redeem page draws for one offering: the catalog when it has items, the sponsor panel
 *  when it has a sponsorship contract, or the "no redeem items" note when it has neither. */
export function redeemSections(p: {items: number | undefined; sponsorship: boolean}): {catalog: boolean; sponsor: boolean; empty: boolean} {
    const catalog = (p.items ?? 0) > 0;
    return {catalog, sponsor: p.sponsorship, empty: p.items !== undefined && !catalog && !p.sponsorship};
}
