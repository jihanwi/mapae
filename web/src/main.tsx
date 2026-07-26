import React from "react";
import ReactDOM from "react-dom/client";
import {createHashRouter, RouterProvider} from "react-router-dom";
import {WagmiProvider} from "wagmi";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {wagmiConfig} from "./config/wagmi";
import {ToastProvider} from "./components/tx";
import App from "./App";
import Home from "./pages/Home";
import Offering from "./pages/Offering";
import Membership from "./pages/Membership";
import Redeem from "./pages/Redeem";
import Trade from "./pages/Trade";
import NotFound from "./pages/NotFound";
import "./index.css";

const qc = new QueryClient({defaultOptions: {queries: {staleTime: 10_000}}});

const router = createHashRouter([
    {
        path: "/",
        element: <App />,
        errorElement: <NotFound />, // 6-b: 렌더/로더 에러 폴백
        children: [
            {index: true, element: <Home />},
            {path: "offering/:addr", element: <Offering />},
            {path: "membership", element: <Membership />},
            {path: "redeem", element: <Redeem />},
            {path: "trade", element: <Trade />},
            {path: "*", element: <NotFound />}, // 6-b: 알 수 없는 라우트 (Nav 포함 레이아웃 내)
        ],
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={qc}>
                <ToastProvider>
                    <RouterProvider router={router} />
                </ToastProvider>
            </QueryClientProvider>
        </WagmiProvider>
    </React.StrictMode>
);
