import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 获取项目根目录。测试环境可以通过环境变量覆盖，避免污染真实数据目录。
 *
 * @returns {string}
 */
function getProjectRoot() {
  return path.resolve(process.env.IELTS_SCRIBE_PROJECT_ROOT ?? process.cwd());
}

/**
 * 获取数据根目录。
 *
 * @returns {string}
 */
function getDataRoot() {
  return path.join(getProjectRoot(), "data");
}

/**
 * 获取草稿目录路径。
 *
 * @returns {string}
 */
function getDraftsDirectoryPath() {
  return path.join(getDataRoot(), "drafts");
}

/**
 * 获取恢复目录路径。
 *
 * @returns {string}
 */
function getRecoveryDirectoryPath() {
  return path.join(getDataRoot(), "recovery");
}

/**
 * 确保本地数据目录存在。
 *
 * @returns {Promise<void>}
 */
export async function ensureDataDirectories() {
  await Promise.all([
    fs.mkdir(getDraftsDirectoryPath(), { recursive: true }),
    fs.mkdir(getSessionsDirectoryPath(), { recursive: true }),
    fs.mkdir(getImagesDirectoryPath(), { recursive: true }),
    fs.mkdir(getRecoveryDirectoryPath(), { recursive: true })
  ]);
}

/**
 * 获取当前草稿文件路径。
 *
 * @returns {string}
 */
export function getCurrentSessionFilePath() {
  return path.join(getDraftsDirectoryPath(), "current-session.json");
}

/**
 * 获取历史会话目录路径。
 *
 * @returns {string}
 */
export function getSessionsDirectoryPath() {
  return path.join(getDataRoot(), "sessions");
}

/**
 * 获取图片目录路径。
 *
 * @returns {string}
 */
export function getImagesDirectoryPath() {
  return path.join(getDataRoot(), "images");
}

/**
 * 原子方式写入 JSON 文件，避免半写入损坏。
 *
 * @param {string} filePath 目标文件路径
 * @param {unknown} payload 需要写入的 JSON 数据
 * @returns {Promise<void>}
 */
export async function writeJsonAtomically(filePath, payload) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const serializedPayload = JSON.stringify(payload, null, 2);

  await fs.writeFile(tempPath, `${serializedPayload}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

/**
 * 读取 JSON 文件；若不存在则返回 null。
 *
 * @template T
 * @param {string} filePath 目标文件路径
 * @returns {Promise<T | null>}
 */
export async function readJsonFile(filePath) {
  try {
    const rawContent = await fs.readFile(filePath, "utf8");
    return JSON.parse(rawContent);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/**
 * 将损坏的 JSON 文件移动到恢复目录，避免后续重复读取失败。
 *
 * @param {string} filePath 损坏文件路径
 * @returns {Promise<string>} 恢复文件新路径
 */
export async function moveBrokenFileToRecovery(filePath) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const recoveredPath = path.join(
    getRecoveryDirectoryPath(),
    `${baseName}-${Date.now()}.broken.json`
  );

  await fs.rename(filePath, recoveredPath);
  return recoveredPath;
}

/**
 * 将上传图片写入项目目录下的数据文件夹。
 *
 * @param {Buffer} fileBuffer 图片二进制内容
 * @param {string} extension 图片后缀名
 * @param {string} sessionId 当前会话 ID
 * @returns {Promise<{ absolutePath: string, relativePath: string }>}
 */
export async function saveImageBuffer(fileBuffer, extension, sessionId) {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const fileName = `${sessionId}-${Date.now()}${normalizedExtension.toLowerCase()}`;
  const absolutePath = path.join(getImagesDirectoryPath(), fileName);
  const relativePath = path.posix.join("data", "images", fileName);

  await fs.writeFile(absolutePath, fileBuffer);

  return {
    absolutePath,
    relativePath
  };
}
