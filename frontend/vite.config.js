import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser talks only to its own origin; Vite forwards /api to the
// API Gateway, so the refresh cookie stays first-party and the gateway
// sees the allowed http://localhost:5173 origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
});
