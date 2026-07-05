import express from "express";
import path from "node:path";
import apiRouter from "./routes/api.js";
import { ensureDataDirectories } from "./services/storage.js";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? "5173", 10);
const apiUrl = `http://127.0.0.1:${port}`;
const appUrl = `http://127.0.0.1:${frontendPort}/`;

/**
 * 获取当前服务使用的项目根目录。测试环境可通过环境变量覆盖。
 *
 * @returns {string}
 */
function getProjectRoot() {
  return path.resolve(process.env.IELTS_SCRIBE_PROJECT_ROOT ?? process.cwd());
}

const terminalColors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m"
};

app.use(express.json({ limit: "3mb" }));
app.use("/api", apiRouter);
app.use("/files", express.static(path.join(getProjectRoot(), "data")));

/**
 * 为一行终端文本补足右侧空格，便于绘制统一宽度的面板。
 *
 * @param {string} text 需要补齐的文本
 * @param {number} width 面板内容宽度
 * @returns {string}
 */
function padTerminalLine(text, width) {
  const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, "").length;
  return `${text}${" ".repeat(Math.max(0, width - visibleLength))}`;
}

/**
 * 生成带边框的终端面板，用于展示启动状态和关键地址。
 *
 * @param {string[]} lines 面板内部文本行
 * @returns {string}
 */
function buildTerminalPanel(lines) {
  const contentWidth = Math.max(
    ...lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length),
    0
  );
  const topBorder = `╭${"─".repeat(contentWidth + 2)}╮`;
  const bottomBorder = `╰${"─".repeat(contentWidth + 2)}╯`;
  const body = lines
    .map((line) => `│ ${padTerminalLine(line, contentWidth)} │`)
    .join("\n");

  return [topBorder, body, bottomBorder].join("\n");
}

/**
 * 输出启动成功后的终端面板，明确区分应用地址和 API 地址。
 *
 * @returns {void}
 */
function printStartupBanner() {
  const lines = [
    `${terminalColors.bold}${terminalColors.cyan}IELTS Scribe API${terminalColors.reset} ${terminalColors.dim}backend service is ready${terminalColors.reset}`,
    "",
    `${terminalColors.green}App${terminalColors.reset}        ${appUrl} ${terminalColors.dim}(start frontend separately)${terminalColors.reset}`,
    `${terminalColors.magenta}API${terminalColors.reset}        ${apiUrl}`,
    `${terminalColors.yellow}Data${terminalColors.reset}       ${path.join(getProjectRoot(), "data")}`,
    "",
    `${terminalColors.dim}If you only ran node server/index.js, the web page is not running yet.${terminalColors.reset}`,
    `${terminalColors.dim}Run npm run dev or npm run dev:client, then open ${appUrl}.${terminalColors.reset}`,
    `${terminalColors.dim}Do not open ${apiUrl} directly; it is the backend service.${terminalColors.reset}`
  ];

  console.log(`\n${buildTerminalPanel(lines)}\n`);
}

/**
 * 统一处理未命中的接口请求。
 *
 * @param {express.Request} _request 请求对象
 * @param {express.Response} response 响应对象
 */
function handleNotFound(_request, response) {
  response.status(404).json({ message: "未找到请求的资源。" });
}

/**
 * 统一处理运行时错误，避免向前端暴露堆栈细节。
 *
 * @param {Error} error 错误对象
 * @param {express.Request} _request 请求对象
 * @param {express.Response} response 响应对象
 * @param {express.NextFunction} _next Express 保留参数
 */
function handleServerError(error, _request, response, _next) {
  console.error("[server]", error);
  response.status(500).json({ message: "服务内部错误，请稍后重试。" });
}

app.use(handleNotFound);
app.use(handleServerError);

/**
 * 启动本地 API 服务。
 *
 * @returns {Promise<void>}
 */
export async function startServer() {
  await ensureDataDirectories();

  app.listen(port, () => {
    if (process.env.QUIET_STARTUP !== "1") {
      printStartupBanner();
    }
  });
}

export default app;

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error("[startup]", error);
    process.exitCode = 1;
  });
}
