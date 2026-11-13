import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser talks only to its own origin; Vite forwards /api to the
// API Gateway, so the refresh cookie stays first-party and the gateway
// sees the allowed http://localhost:5173 origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // face-api is only imported by lazily loaded screens (kiosk, enrollment).
  // Pre-bundling it at startup stops Vite from re-optimizing mid-session,
  // which invalidates open pages ("Outdated Optimize Dep").
  optimizeDeps: {
    include: ["@vladmandic/face-api"],
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
});
