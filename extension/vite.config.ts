import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",

  build: {
    emptyOutDir: true,

    rollupOptions: {
      input: {
        main: "index.html",
        voice: "voice.html"
      }
    }
  }
});