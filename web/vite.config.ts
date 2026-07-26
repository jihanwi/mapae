import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project path
export default defineConfig({
    base: "/mapae/",
    plugins: [react()],
});
