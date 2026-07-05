import express from "express";
import multer from "multer";
import path from "node:path";
import {
  archiveCurrentSession,
  deleteArchivedSession,
  getArchivedSessionById,
  getCurrentSession,
  listArchivedSessions,
  saveCurrentSession
} from "../services/sessionService.js";
import { saveImageBuffer } from "../services/storage.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * 提取上传文件后缀名，并对缺省类型做保底处理。
 *
 * @param {Express.Multer.File} file 上传文件
 * @returns {string}
 */
function resolveImageExtension(file) {
  const extensionFromName = path.extname(file.originalname || "");

  if (extensionFromName) {
    return extensionFromName;
  }

  if (file.mimetype === "image/png") {
    return ".png";
  }

  if (file.mimetype === "image/jpeg") {
    return ".jpg";
  }

  if (file.mimetype === "image/webp") {
    return ".webp";
  }

  return ".png";
}

/**
 * 统一包装异步路由，避免重复编写 try/catch。
 *
 * @param {(req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>} handler 异步处理函数
 * @returns {express.RequestHandler}
 */
function wrapAsyncHandler(handler) {
  return (request, response, next) => {
    handler(request, response, next).catch(next);
  };
}

router.get(
  "/session/current",
  wrapAsyncHandler(async (_request, response) => {
    const currentSession = await getCurrentSession();
    response.json({ session: currentSession });
  })
);

router.put(
  "/session/current",
  wrapAsyncHandler(async (request, response) => {
    const savedSession = await saveCurrentSession(request.body?.session ?? request.body);
    response.json({ session: savedSession });
  })
);

router.post(
  "/session/archive",
  wrapAsyncHandler(async (_request, response) => {
    const archiveResult = await archiveCurrentSession(false);
    response.json(archiveResult);
  })
);

router.get(
  "/sessions",
  wrapAsyncHandler(async (_request, response) => {
    const sessions = await listArchivedSessions();
    response.json({ sessions });
  })
);

router.get(
  "/sessions/:sessionId",
  wrapAsyncHandler(async (request, response) => {
    const session = await getArchivedSessionById(request.params.sessionId);

    if (!session) {
      response.status(404).json({ message: "未找到对应历史记录。" });
      return;
    }

    response.json({ session });
  })
);

router.delete(
  "/sessions/:sessionId",
  wrapAsyncHandler(async (request, response) => {
    const deleteResult = await deleteArchivedSession(request.params.sessionId);

    if (!deleteResult.deleted) {
      response.status(404).json({ message: "未找到对应历史记录。" });
      return;
    }

    response.json(deleteResult);
  })
);

router.post(
  "/images",
  upload.single("image"),
  wrapAsyncHandler(async (request, response) => {
    const uploadedFile = request.file;
    const sessionId = typeof request.body?.sessionId === "string" ? request.body.sessionId : "";

    if (!uploadedFile || !uploadedFile.buffer) {
      response.status(400).json({ message: "未接收到图片文件。" });
      return;
    }

    if (!sessionId.trim()) {
      response.status(400).json({ message: "缺少 sessionId。" });
      return;
    }

    const savedFile = await saveImageBuffer(
      uploadedFile.buffer,
      resolveImageExtension(uploadedFile),
      sessionId
    );

    response.status(201).json({
      imagePath: `/${savedFile.relativePath.replace(/^data\//, "files/")}`,
      relativePath: savedFile.relativePath
    });
  })
);

export default router;
