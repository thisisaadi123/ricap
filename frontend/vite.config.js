import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports differ from RISE (5180 / 4100) so both apps can run side by side.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    open: true,
    proxy: {
      "/api": {
        target: "http://localhost:4200",
        changeOrigin: true,
      },
    },
  },
});
