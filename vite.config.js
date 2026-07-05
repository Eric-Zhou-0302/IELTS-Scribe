import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 创建前端开发配置，并将本地 API 代理到 Express 服务。
 *
 * @returns {import("vite").UserConfig}
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/files": "http://127.0.0.1:8787"
    }
  },
  test: {
    environment: "jsdom"
  }
});
