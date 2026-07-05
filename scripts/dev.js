import { spawn } from "node:child_process";
import process from "node:process";

const frontendUrl = "http://127.0.0.1:5173/";

const terminalColors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m"
};

/**
 * 为统一面板中的文本补齐宽度，保证边框对齐。
 *
 * @param {string} text 需要显示的文本
 * @param {number} width 目标宽度
 * @returns {string}
 */
function padLine(text, width) {
  const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, "").length;
  return `${text}${" ".repeat(Math.max(0, width - visibleLength))}`;
}

/**
 * 构造一个简单的终端面板，统一显示启动说明。
 *
 * @param {string[]} lines 面板内容
 * @returns {string}
 */
function buildPanel(lines) {
  const contentWidth = Math.max(...lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length), 0);
  const topBorder = `╭${"─".repeat(contentWidth + 2)}╮`;
  const bottomBorder = `╰${"─".repeat(contentWidth + 2)}╯`;
  const body = lines.map((line) => `│ ${padLine(line, contentWidth)} │`).join("\n");

  return [topBorder, body, bottomBorder].join("\n");
}

/**
 * 将子进程错误输出增加标签，便于排查失败原因。
 *
 * @param {"client" | "server"} label 输出标签
 * @param {string} color ANSI 颜色码
 * @param {NodeJS.ReadableStream | null} stream 输出流
 */
function pipeErrorLogs(label, color, stream) {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean);

    for (const line of lines) {
      process.stdout.write(`${color}${label}${terminalColors.reset} ${line}\n`);
    }
  });
}

/**
 * 启动一个 npm 子命令。
 *
 * @param {"client" | "server"} label 子进程标签
 * @param {string[]} args npm 参数
 * @param {Record<string, string>} [extraEnv] 附加环境变量
 * @returns {import("node:child_process").ChildProcessWithoutNullStreams}
 */
function startProcess(label, args, extraEnv = {}) {
  const childProcess = spawn("npm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`,
      ...extraEnv
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  const color = label === "client" ? terminalColors.cyan : terminalColors.magenta;

  pipeErrorLogs(label, color, childProcess.stderr);

  return childProcess;
}

/**
 * 关闭所有子进程，避免遗留后台服务。
 *
 * @param {Array<import("node:child_process").ChildProcessWithoutNullStreams>} children 子进程列表
 * @returns {void}
 */
function shutdownChildren(children) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
}

const children = [
  startProcess("server", ["run", "dev:server"], {
    QUIET_STARTUP: "1"
  }),
  startProcess("client", ["run", "dev:client", "--", "--host", "127.0.0.1", "--clearScreen", "false"])
];

let hasExited = false;
let serverReady = false;
let clientReady = false;
let bannerPrinted = false;

/**
 * 在前后端都就绪后，只输出一个应用 URL。
 *
 * @returns {void}
 */
function printReadyBannerOnce() {
  if (bannerPrinted || !serverReady || !clientReady) {
    return;
  }

  bannerPrinted = true;

  console.log(
    `\n${buildPanel([
      `${terminalColors.bold}${terminalColors.yellow}IELTS Scribe${terminalColors.reset} ${terminalColors.dim}application is ready${terminalColors.reset}`,
      "",
      `${terminalColors.cyan}${frontendUrl}${terminalColors.reset}`
    ])}\n`
  );
}

/**
 * 统一退出主进程，并确保子进程都被关闭。
 *
 * @param {number} code 退出码
 * @returns {void}
 */
function exitOnce(code) {
  if (hasExited) {
    return;
  }

  hasExited = true;
  shutdownChildren(children);
  process.exit(code);
}

children[0].stdout.on("data", () => {
  serverReady = true;
  printReadyBannerOnce();
});

children[1].stdout.on("data", (chunk) => {
  const output = chunk.toString();

  if (output.includes("Local:")) {
    clientReady = true;
    printReadyBannerOnce();
  }
});

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (signal && signal !== "SIGINT") {
      process.stdout.write(`${terminalColors.yellow}dev${terminalColors.reset} process exited with signal ${signal}\n`);
      exitOnce(1);
      return;
    }

    if (typeof code === "number" && code !== 0) {
      process.stdout.write(`${terminalColors.yellow}dev${terminalColors.reset} process exited with code ${code}\n`);
      exitOnce(code);
    }
  });
}

process.on("SIGINT", () => {
  exitOnce(0);
});

process.on("SIGTERM", () => {
  exitOnce(0);
});
