// What the metadata save status shows, per context. Pure so the state transitions are testable.
// "launch" is the launch success screen: right after the launch tx the server RPC may not see the
// curve yet, so not_curve there means "still catching up", never "not a MAPAE curve", and both it
// and temporary failures offer a retry that keeps the chosen image and inputs (and signs again).
import type {SaveState} from "../hooks/meta";

export type SaveContext = "launch" | "add";

export type SaveView =
    | {kind: "none"}
    | {kind: "progress"; phase: "signing" | "uploading"}
    | {kind: "saved"}
    | {kind: "error"; message: string; canRetry: boolean; retryLabel: "saveAgain" | "retry"};

/** Codes that can never succeed on retry (the record exists, or the wallet is not the Dev). */
const FINAL = new Set(["already_saved", "not_dev"]);

export function saveView(state: SaveState, context: SaveContext): SaveView {
    if (state.phase === "idle") return {kind: "none"};
    if (state.phase === "signing" || state.phase === "uploading") return {kind: "progress", phase: state.phase};
    if (state.phase === "saved") return {kind: "saved"};
    const code = state.code;
    if (context === "launch") {
        return {kind: "error", message: code === "not_curve" ? "launchPending" : code, canRetry: !FINAL.has(code), retryLabel: "saveAgain"};
    }
    return {kind: "error", message: code, canRetry: !FINAL.has(code) && code !== "not_curve", retryLabel: "retry"};
}
