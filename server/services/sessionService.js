import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ensureDataDirectories,
  getCurrentSessionFilePath,
  getSessionsDirectoryPath,
  moveBrokenFileToRecovery,
  readJsonFile,
  writeJsonAtomically
} from "./storage.js";

/**
 * 获取当前服务使用的项目根目录。测试环境可通过环境变量覆盖。
 *
 * @returns {string}
 */
function getProjectRoot() {
  return path.resolve(process.env.IELTS_SCRIBE_PROJECT_ROOT ?? process.cwd());
}

/**
 * 创建默认的空白会话对象。
 *
 * @returns {SessionRecord}
 */
export function createEmptySession() {
  return {
    sessionId: `session_${randomUUID()}`,
    draftText: "",
    imagePath: "",
    promptSource: "",
    timerMode: 20,
    remainingSeconds: 20 * 60,
    timerStatus: "idle",
    wordCountVisible: true,
    theme: "dark",
    startedAt: null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 校正前端传入的会话对象，保证字段类型稳定。
 *
 * @param {Partial<SessionRecord>} inputSession 前端输入
 * @returns {SessionRecord}
 */
export function sanitizeSessionPayload(inputSession = {}) {
  const fallbackSession = createEmptySession();
  const normalizedTimerMode = inputSession.timerMode === 40 ? 40 : 20;
  const normalizedRemainingSeconds =
    typeof inputSession.remainingSeconds === "number" && inputSession.remainingSeconds >= 0
      ? Math.floor(inputSession.remainingSeconds)
      : normalizedTimerMode * 60;
  const allowedTimerStatuses = new Set(["idle", "running", "paused"]);
  const normalizedTimerStatus = allowedTimerStatuses.has(inputSession.timerStatus)
    ? inputSession.timerStatus
    : "idle";

  return {
    sessionId:
      typeof inputSession.sessionId === "string" && inputSession.sessionId.trim()
        ? inputSession.sessionId
        : fallbackSession.sessionId,
    draftText: typeof inputSession.draftText === "string" ? inputSession.draftText : "",
    imagePath: typeof inputSession.imagePath === "string" ? inputSession.imagePath : "",
    promptSource: typeof inputSession.promptSource === "string" ? inputSession.promptSource : "",
    timerMode: normalizedTimerMode,
    remainingSeconds: normalizedRemainingSeconds,
    timerStatus: normalizedTimerStatus,
    wordCountVisible:
      typeof inputSession.wordCountVisible === "boolean" ? inputSession.wordCountVisible : true,
    theme: inputSession.theme === "light" ? "light" : "dark",
    startedAt:
      typeof inputSession.startedAt === "string" || inputSession.startedAt === null
        ? inputSession.startedAt ?? null
        : null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 读取当前草稿；若文件不存在则返回一个新的空白会话。
 *
 * @returns {Promise<SessionRecord>}
 */
export async function getCurrentSession() {
  await ensureDataDirectories();

  const filePath = getCurrentSessionFilePath();

  try {
    const storedSession = await readJsonFile(filePath);

    if (!storedSession) {
      const emptySession = createEmptySession();
      await writeJsonAtomically(filePath, emptySession);
      return emptySession;
    }

    return sanitizeSessionPayload(storedSession);
  } catch (error) {
    await moveBrokenFileToRecovery(filePath);

    const recoveredSession = createEmptySession();
    await writeJsonAtomically(filePath, recoveredSession);
    return recoveredSession;
  }
}

/**
 * 保存当前草稿。
 *
 * @param {Partial<SessionRecord>} sessionPayload 当前会话内容
 * @returns {Promise<SessionRecord>}
 */
export async function saveCurrentSession(sessionPayload) {
  await ensureDataDirectories();

  const sanitizedSession = sanitizeSessionPayload(sessionPayload);
  await writeJsonAtomically(getCurrentSessionFilePath(), sanitizedSession);

  return sanitizedSession;
}

/**
 * 根据当前草稿生成归档对象。
 *
 * @param {SessionRecord} currentSession 当前会话
 * @returns {ArchivedSessionRecord}
 */
export function buildArchivedSession(currentSession) {
  return {
    sessionId: currentSession.sessionId,
    draftText: currentSession.draftText,
    imagePath: currentSession.imagePath,
    promptSource: currentSession.promptSource,
    timerMode: currentSession.timerMode,
    remainingSeconds: currentSession.remainingSeconds,
    timerStatus: currentSession.timerStatus,
    wordCountVisible: currentSession.wordCountVisible,
    theme: currentSession.theme,
    startedAt: currentSession.startedAt,
    endedAt: new Date().toISOString(),
    wordCount: countWords(currentSession.draftText),
    createdAt: currentSession.updatedAt
  };
}

/**
 * 归档当前会话，并创建新的空白会话。
 *
 * @param {boolean} preserveEmpty 是否允许归档空白会话
 * @returns {Promise<{ archived: ArchivedSessionRecord | null, current: SessionRecord }>}
 */
export async function archiveCurrentSession(preserveEmpty = false) {
  await ensureDataDirectories();

  const currentSession = await getCurrentSession();
  const hasMeaningfulContent =
    currentSession.draftText.trim().length > 0 || currentSession.imagePath.trim().length > 0;

  let archivedSession = null;

  if (preserveEmpty || hasMeaningfulContent) {
    archivedSession = buildArchivedSession(currentSession);
    const archivePath = path.join(getSessionsDirectoryPath(), `${currentSession.sessionId}.json`);
    await writeJsonAtomically(archivePath, archivedSession);
  }

  const nextSession = createEmptySession();
  await writeJsonAtomically(getCurrentSessionFilePath(), nextSession);

  return {
    archived: archivedSession,
    current: nextSession
  };
}

/**
 * 获取历史会话列表，并按时间倒序返回。
 *
 * @returns {Promise<ArchivedSessionRecord[]>}
 */
export async function listArchivedSessions() {
  await ensureDataDirectories();

  const fileNames = await fs.readdir(getSessionsDirectoryPath());
  const sessionRecords = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const filePath = path.join(getSessionsDirectoryPath(), fileName);

        try {
          return await readJsonFile(filePath);
        } catch (error) {
          await moveBrokenFileToRecovery(filePath);
          return null;
        }
      })
  );

  return sessionRecords
    .filter(Boolean)
    .map((sessionRecord) => ({
      ...sessionRecord,
      promptSource: typeof sessionRecord.promptSource === "string" ? sessionRecord.promptSource : ""
    }))
    .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime());
}

/**
 * 获取指定归档会话的详情。
 *
 * @param {string} sessionId 会话 ID
 * @returns {Promise<ArchivedSessionRecord | null>}
 */
export async function getArchivedSessionById(sessionId) {
  await ensureDataDirectories();

  const archivePath = path.join(getSessionsDirectoryPath(), `${sessionId}.json`);

  try {
    const archivedSession = await readJsonFile(archivePath);

    if (!archivedSession) {
      return null;
    }

    return {
      ...archivedSession,
      promptSource: typeof archivedSession.promptSource === "string" ? archivedSession.promptSource : ""
    };
  } catch (error) {
    await moveBrokenFileToRecovery(archivePath);
    return null;
  }
}

/**
 * 将前端可访问的图片路径转换为项目内绝对路径。
 *
 * @param {string} imagePath 图片路径
 * @returns {string | null}
 */
function resolveImagePathToAbsolutePath(imagePath) {
  if (!imagePath.trim()) {
    return null;
  }

  if (imagePath.startsWith("/files/")) {
    return path.join(getProjectRoot(), "data", imagePath.replace(/^\/files\//, ""));
  }

  if (imagePath.startsWith("data/")) {
    return path.join(getProjectRoot(), imagePath);
  }

  return null;
}

/**
 * 判断某张图片是否仍被当前草稿或其他历史记录引用。
 *
 * @param {string} imagePath 图片路径
 * @param {string} excludedSessionId 本次删除排除的历史会话 ID
 * @returns {Promise<boolean>}
 */
async function isImageStillReferenced(imagePath, excludedSessionId) {
  if (!imagePath.trim()) {
    return false;
  }

  const currentSession = await getCurrentSession();

  if (currentSession.imagePath === imagePath) {
    return true;
  }

  const archivedSessions = await listArchivedSessions();

  return archivedSessions.some(
    (archivedSession) =>
      archivedSession.sessionId !== excludedSessionId && archivedSession.imagePath === imagePath
  );
}

/**
 * 删除一条历史记录，并在图片不再被引用时清理关联图片。
 *
 * @param {string} sessionId 会话 ID
 * @returns {Promise<{ deleted: boolean, deletedSessionId: string, deletedImage: boolean }>}
 */
export async function deleteArchivedSession(sessionId) {
  await ensureDataDirectories();

  const archivePath = path.join(getSessionsDirectoryPath(), `${sessionId}.json`);
  const archivedSession = await getArchivedSessionById(sessionId);

  if (!archivedSession) {
    return {
      deleted: false,
      deletedSessionId: sessionId,
      deletedImage: false
    };
  }

  await fs.rm(archivePath, { force: true });

  let deletedImage = false;

  if (archivedSession.imagePath && !(await isImageStillReferenced(archivedSession.imagePath, sessionId))) {
    const absoluteImagePath = resolveImagePathToAbsolutePath(archivedSession.imagePath);

    if (absoluteImagePath) {
      await fs.rm(absoluteImagePath, { force: true });
      deletedImage = true;
    }
  }

  return {
    deleted: true,
    deletedSessionId: sessionId,
    deletedImage
  };
}

/**
 * 统计英文写作词数。
 *
 * @param {string} text 写作内容
 * @returns {number}
 */
export function countWords(text) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return 0;
  }

  return normalizedText.split(/\s+/).filter(Boolean).length;
}

/**
 * @typedef {Object} SessionRecord
 * @property {string} sessionId
 * @property {string} draftText
 * @property {string} imagePath
 * @property {string} promptSource
 * @property {20 | 40} timerMode
 * @property {number} remainingSeconds
 * @property {"idle" | "running" | "paused"} timerStatus
 * @property {boolean} wordCountVisible
 * @property {"dark" | "light"} theme
 * @property {string | null} startedAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} ArchivedSessionRecord
 * @property {string} sessionId
 * @property {string} draftText
 * @property {string} imagePath
 * @property {string} promptSource
 * @property {20 | 40} timerMode
 * @property {number} remainingSeconds
 * @property {"idle" | "running" | "paused"} timerStatus
 * @property {boolean} wordCountVisible
 * @property {"dark" | "light"} theme
 * @property {string | null} startedAt
 * @property {string} endedAt
 * @property {number} wordCount
 * @property {string} createdAt
 */
