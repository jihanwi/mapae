// W-T45: the testnet app's routes, loaded with a dynamic import so a waitlist-only host never
// downloads them. The routes are the same as before; /waitlist and /privacy moved to the waitlist
// shell (no app menu).
import type {RouteObject} from "react-router-dom";
import App from "./App";
import Home from "./pages/Home";
import Curves from "./pages/Curves";
import Token from "./pages/Token";
import Wallet from "./pages/Wallet";
import Create from "./pages/Create";
import Feed from "./pages/Feed";
import Offering from "./pages/Offering";
import OfferingNew from "./pages/OfferingNew";
import Membership from "./pages/Membership";
import Redeem from "./pages/Redeem";
import Trade from "./pages/Trade";
import NotFound from "./pages/NotFound";

export const appRoutes: RouteObject[] = [
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
            {path: "offerings/new", element: <OfferingNew />}, // W-T34: open an offering on the current L1 factory
            {path: "offering/:addr", element: <Offering />},
            {path: "membership", element: <Membership />},
            {path: "redeem", element: <Redeem />},
            {path: "trade", element: <Trade />},
            {path: "*", element: <NotFound />}, // 6-b: 알 수 없는 라우트 (Nav 포함 레이아웃 내)
        ],
    },
];
