import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { strictPort: !!process.env.TAURI_ENV_PLATFORM },
  clearScreen: false,
  build: {
    rollupOptions: {
      input: { main: "index.html", overlay: "overlay.html" },
    },
  },
});
