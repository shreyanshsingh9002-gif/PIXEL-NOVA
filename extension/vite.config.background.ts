import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/background/background.ts",
      formats: ["es"],
      fileName: () => "background.js"
    },
    rollupOptions: {
      output: {
        entryFileNames: "background.js"
      }
    }
  }
});

