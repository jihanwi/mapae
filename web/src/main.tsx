import React from "react";
import ReactDOM from "react-dom/client";
import {createHashRouter, RouterProvider} from "react-router-dom";
import {WagmiProvider} from "wagmi";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {wagmiConfig} from "./config/wagmi";
import {ToastProvider} from "./components/tx";
import {LangProvider} from "./copy";
import App from "./App";
import Home from "./pages/Home";
import Curves from "./pages/Curves";
import Token from "./pages/Token";
import Wallet from "./pages/Wallet";
import Create from "./pages/Create";
import Feed from "./pages/Feed";
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
            {index: true, element: <Curves />}, // v3 curve list
            {path: "t/:curve", element: <Token />}, // v3 token page
            {path: "w/:address", element: <Wallet />}, // public wallet profile
            {path: "create", element: <Create />}, // v3 curve creation
            {path: "feed", element: <Feed />}, // trades of followed wallets (decision 53)
            {path: "offerings", element: <Home />}, // legacy fixed-price offerings (was "/")
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
                <LangProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </LangProvider>
            </QueryClientProvider>
        </WagmiProvider>
    </React.StrictMode>
);
