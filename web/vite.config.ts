import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Built into ../public, which Vercel serves as static files next to the API function.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../public", emptyOutDir: true },
  server: {
    proxy: {
      "/v1": "http://localhost:8787",
      "/healthz": "http://localhost:8787",
    },
  },
});
