import React from "react";
import ReactDOM from "react-dom/client";
import {createHashRouter, RouteObject, RouterProvider} from "react-router-dom";
import {WagmiProvider} from "wagmi";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {wagmiConfig} from "./config/wagmi";
import {ToastProvider} from "./components/tx";
import {LangProvider} from "./copy";
import {ToWaitlist, WaitlistNote, WaitlistShell} from "./WaitlistShell";
import Waitlist from "./pages/Waitlist";
import Privacy from "./pages/Privacy";
import {WAITLIST_ONLY} from "./lib/waitlistOnly";
import "./index.css";

const qc = new QueryClient({defaultOptions: {queries: {staleTime: 10_000}}});

/** /waitlist and /privacy in their own shell (W-T45): no app menu on any host. */
const waitlistRoutes: RouteObject[] = [
    {path: "/waitlist", element: <WaitlistShell />, children: [{index: true, element: <Waitlist />}]}, // W-T43 (FEATURE_WAITLIST)
    {path: "/privacy", element: <WaitlistShell />, children: [{index: true, element: <Privacy />}]}, // W-T43: only with the email field on
];

/** A waitlist-only host (VITE_WAITLIST_ONLY_HOSTS): the two waitlist routes and nothing else; every
 *  other path, the root included, goes to /waitlist with ref and lang kept. */
const onlyRoutes: RouteObject[] = [
    ...waitlistRoutes,
    {path: "*", element: <ToWaitlist />, errorElement: <WaitlistShell><WaitlistNote title="MAPAE" /></WaitlistShell>},
];

function render(routes: RouteObject[]) {
    const router = createHashRouter(routes);
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <WagmiProvider config={wagmiConfig}>
                <QueryClientProvider client={qc}>
                    <LangProvider>
                        <ToastProvider>
                            <RouterProvider router={router} />
                        </ToastProvider>
                    </LangProvider>
                </QueryClientProvider>
            </WagmiProvider>
        </React.StrictMode>
    );
}

if (WAITLIST_ONLY) {
    render(onlyRoutes);
} else {
    // the testnet app is its own chunk: a waitlist-only host never downloads it
    import("./appRoutes").then(
        (m) => render([...waitlistRoutes, ...m.appRoutes]),
        (e) => {
            console.error("app routes failed to load", e);
            throw e;
        }
    );
}
