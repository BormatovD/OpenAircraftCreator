import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// npm run dev   — живая разработка (web/), ядро импортируется из src/ напрямую.
// npm run build — один офлайн-файл dist/index.html: three.js, ядро, шрифт и стили внутри.
export default defineConfig({
  root: "web",
  server: {
    proxy: {
      "^/api/aircraft/type(?:\\?|$)": {
        target: "https://flightcost.app",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", req => {
            req.removeHeader("cookie");
            req.removeHeader("authorization");
          });
          proxy.on("proxyRes", res => { delete res.headers["set-cookie"]; });
        },
      },
    },
  },
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
  },
});
