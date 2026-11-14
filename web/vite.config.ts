import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the app under /mapae/ (default); Vercel sets VITE_BASE=/ for a root deploy.
export default defineConfig({
    base: process.env.VITE_BASE ?? "/mapae/",
    plugins: [react()],
});
