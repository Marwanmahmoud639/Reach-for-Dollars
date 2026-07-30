// Netlify-specific Vite config. Used only by `npm run build:netlify`.
// The default `vite.config.ts` (Cloudflare preset) is left untouched so the
// Lovable in-product preview keeps working.
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const serverEnv = loadEnv(process.env.NODE_ENV || "production", process.cwd(), "");
Object.assign(process.env, serverEnv);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
      "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
      entities: path.resolve(__dirname, "node_modules/entities"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      target: "netlify",
      customViteReactPlugin: true,
    }),
    viteReact(),
  ],
});
