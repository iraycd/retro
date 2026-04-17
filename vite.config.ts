import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "http://localhost:7179",
        ws: true,
        changeOrigin: false,
      },
      "/api": {
        target: "http://localhost:7179",
        changeOrigin: false,
      },
    },
  },
});
