import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
        assetFileNames: ({ names }) =>
          names?.some((n) => n.endsWith(".css"))
            ? "index.css"
            : "[name][extname]",
      },
    },
  },
});
