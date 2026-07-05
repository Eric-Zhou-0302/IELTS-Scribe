import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let app;
let sandboxRoot;
let currentSessionPath;
let archivedSessionPath;
let imageFilePath;

describe("session api", () => {
  beforeEach(async () => {
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ielts-scribe-test-"));
    process.env.IELTS_SCRIBE_PROJECT_ROOT = sandboxRoot;

    currentSessionPath = path.join(sandboxRoot, "data", "drafts", "current-session.json");
    archivedSessionPath = path.join(sandboxRoot, "data", "sessions", "session_to_delete.json");
    imageFilePath = path.join(sandboxRoot, "data", "images", "shared-image.png");

    vi.resetModules();
    ({ default: app } = await import("../server/index.js"));
  });

  afterEach(async () => {
    delete process.env.IELTS_SCRIBE_PROJECT_ROOT;
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  });

  it("creates and returns a current session", async () => {
    const response = await request(app).get("/api/session/current");

    expect(response.statusCode).toBe(200);
    expect(response.body.session.sessionId).toBeTruthy();
  });

  it("saves the current session payload", async () => {
    const payload = {
      session: {
        sessionId: "session_test_1",
        draftText: "Test draft",
        imagePath: "",
        promptSource: "剑桥雅思 18 Test 2 Task 1",
        timerMode: 20,
        remainingSeconds: 1200,
        timerStatus: "paused",
        wordCountVisible: true,
        theme: "dark",
        startedAt: null
      }
    };

    const response = await request(app).put("/api/session/current").send(payload);

    expect(response.statusCode).toBe(200);
    expect(response.body.session.draftText).toBe("Test draft");
    expect(response.body.session.promptSource).toBe("剑桥雅思 18 Test 2 Task 1");

    const storedSession = JSON.parse(await fs.readFile(currentSessionPath, "utf8"));
    expect(storedSession.sessionId).toBe("session_test_1");
    expect(storedSession.promptSource).toBe("剑桥雅思 18 Test 2 Task 1");
  });

  it("deletes an archived session and cleans up an unreferenced image", async () => {
    await fs.mkdir(path.dirname(archivedSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(imageFilePath), { recursive: true });

    await fs.writeFile(
      archivedSessionPath,
      JSON.stringify({
        sessionId: "session_to_delete",
        draftText: "Archived draft",
        imagePath: "/files/images/shared-image.png",
        promptSource: "剑桥雅思 17 Test 3 Task 2",
        timerMode: 20,
        remainingSeconds: 600,
        timerStatus: "paused",
        wordCountVisible: true,
        theme: "dark",
        startedAt: null,
        endedAt: new Date().toISOString(),
        wordCount: 2,
        createdAt: new Date().toISOString()
      }),
      "utf8"
    );
    await fs.writeFile(imageFilePath, "fake-image", "utf8");

    const response = await request(app).delete("/api/sessions/session_to_delete");

    expect(response.statusCode).toBe(200);
    expect(response.body.deleted).toBe(true);
    await expect(fs.access(archivedSessionPath)).rejects.toThrow();
    await expect(fs.access(imageFilePath)).rejects.toThrow();
  });

  it("keeps the image file when it is still referenced by the current draft", async () => {
    await fs.mkdir(path.dirname(currentSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(archivedSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(imageFilePath), { recursive: true });

    await fs.writeFile(
      currentSessionPath,
      JSON.stringify({
        sessionId: "current_session_1",
        draftText: "",
        imagePath: "/files/images/shared-image.png",
        promptSource: "剑桥雅思 16 Test 1 Task 1",
        timerMode: 20,
        remainingSeconds: 1200,
        timerStatus: "idle",
        wordCountVisible: true,
        theme: "dark",
        startedAt: null,
        updatedAt: new Date().toISOString()
      }),
      "utf8"
    );

    await fs.writeFile(
      archivedSessionPath,
      JSON.stringify({
        sessionId: "session_to_delete",
        draftText: "Archived draft",
        imagePath: "/files/images/shared-image.png",
        promptSource: "剑桥雅思 16 Test 2 Task 2",
        timerMode: 20,
        remainingSeconds: 600,
        timerStatus: "paused",
        wordCountVisible: true,
        theme: "dark",
        startedAt: null,
        endedAt: new Date().toISOString(),
        wordCount: 2,
        createdAt: new Date().toISOString()
      }),
      "utf8"
    );
    await fs.writeFile(imageFilePath, "fake-image", "utf8");

    const response = await request(app).delete("/api/sessions/session_to_delete");

    expect(response.statusCode).toBe(200);
    expect(response.body.deletedImage).toBe(false);
    await expect(fs.access(imageFilePath)).resolves.toBeUndefined();
  });
});
