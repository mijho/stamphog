import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react-swc";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const API_URL = process.env.VITE_API_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    nitro({
      preset: "bun",
      routeRules: {
        "/api/**": {
          proxy: `${API_URL}/api/**`,
        },
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
});
