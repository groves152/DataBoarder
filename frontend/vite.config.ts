import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Dev server proxies to the Python FastAPI backend so the frontend can hit
// /api/* and /ws without CORS issues during development.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8779",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8779",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../databoarder/static",
    emptyOutDir: true,
  },
});
