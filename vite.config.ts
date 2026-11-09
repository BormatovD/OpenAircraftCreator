import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// npm run dev   — живая разработка (web/), ядро импортируется из src/ напрямую.
// npm run build — один офлайн-файл dist/index.html: three.js, ядро, шрифт и стили внутри.
export default defineConfig({
  root: "web",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
  },
});
