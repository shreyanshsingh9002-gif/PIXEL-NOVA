import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,

    lib: {
      entry: "src/content/content.ts",
      formats: ["iife"],
      name: "PixelNovaContent"
    },

    rollupOptions: {
      output: {
        entryFileNames: "content.js"
      }
    }
  }
});