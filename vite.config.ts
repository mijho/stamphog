import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react-swc";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: ["millions-lightbox-chamber-matrix.trycloudflare.com"],
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    nitro({ preset: "vercel" }),
    viteReact(),
    tailwindcss(),
  ],
});
