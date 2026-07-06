import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const AUTO_SAVE_DELAY = 1800;
const IMAGE_OVERLAY_DISMISS_DELAY_MS = 2000;

/**
 * 创建前端兜底会话，避免接口未返回前组件访问空值。
 *
 * @returns {import("../server/services/sessionService.js").SessionRecord}
 */
export function createFallbackSession() {
  return {
    sessionId: `session_fallback_${Date.now()}`,
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
 * 将秒数格式化为 mm:ss 文本。
 *
 * @param {number} totalSeconds 总秒数
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

/**
 * 统计写作内容词数。
 *
 * @param {string} text 写作文本
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
 * 根据保存状态生成顶部提示文案。
 *
 * @param {{ status: string, savedAt: number | null }} saveState 保存状态
 * @returns {string}
 */
export function resolveSaveStatusLabel(saveState) {
  if (saveState.status === "loading") {
    return "加载中";
  }

  if (saveState.status === "saving") {
    return "保存中";
  }

  if (saveState.status === "error") {
    return "保存失败";
  }

  if (saveState.savedAt) {
    return "已保存";
  }

  return "未保存";
}

/**
 * 根据保存状态生成更详细的悬停提示。
 *
 * @param {{ status: string, savedAt: number | null }} saveState 保存状态
 * @returns {string}
 */
export function resolveSaveStatusTitle(saveState) {
  if (saveState.status === "loading") {
    return "正在加载当前草稿。";
  }

  if (saveState.status === "saving") {
    return "正在自动保存当前草稿。";
  }

  if (saveState.status === "error") {
    return "草稿保存失败，请稍后重试。";
  }

  if (saveState.savedAt) {
    return `最近一次自动保存：${new Date(saveState.savedAt).toLocaleTimeString("zh-CN")}`;
  }

  return "当前草稿尚未保存。";
}

/**
 * 将 ISO 时间格式化为更适合界面展示的本地时间。
 *
 * @param {string | null | undefined} value 时间字符串
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) {
    return "未记录";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * 根据计时模式返回更贴近练习语义的标签。
 *
 * @param {20 | 40} timerMode 计时模式
 * @returns {string}
 */
export function resolvePracticeLabel(timerMode) {
  return timerMode === 20 ? "Task 1 练习" : "Task 2 练习";
}

/**
 * 生成历史记录列表中的简短摘要。
 *
 * @param {string} text 正文内容
 * @returns {string}
 */
export function buildDraftExcerpt(text) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "仅保存了题目图片或空白练习。";
  }

  return normalizedText.slice(0, 120);
}

/**
 * 生成题目来源展示文案。
 *
 * @param {string | null | undefined} promptSource 题目来源
 * @returns {string}
 */
export function resolvePromptSourceLabel(promptSource) {
  return promptSource?.trim() ? promptSource.trim() : "未填写题目来源";
}

/**
 * 判断当前练习是否已经产生了未归档的有效内容。
 *
 * @param {import("../server/services/sessionService.js").SessionRecord} session 当前会话
 * @returns {boolean}
 */
export function hasUnarchivedProgress(session) {
  if (session.draftText.trim()) {
    return true;
  }

  if (session.promptSource.trim()) {
    return true;
  }

  if (session.imagePath) {
    return true;
  }

  if (session.startedAt) {
    return true;
  }

  if (session.timerStatus !== "idle") {
    return true;
  }

  return session.remainingSeconds !== session.timerMode * 60;
}

/**
 * 判断历史记录是否匹配题目来源筛选关键词。
 *
 * @param {import("../server/services/sessionService.js").ArchivedSessionRecord} session 历史会话
 * @param {string} query 筛选关键词
 * @returns {boolean}
 */
export function matchesPromptSourceFilter(session, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");

  if (!normalizedQuery) {
    return true;
  }

  return resolvePromptSourceLabel(session.promptSource)
    .toLocaleLowerCase("zh-CN")
    .includes(normalizedQuery);
}

/**
 * 封装 JSON 请求，统一处理错误。
 *
 * @template T
 * @param {string} url 请求地址
 * @param {RequestInit} [options] 请求参数
 * @returns {Promise<T>}
 */
async function requestJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(errorPayload.message || `请求失败: ${response.status}`);
  }

  return response.json();
}

/**
 * 使用 keepalive 在页面关闭时提交最后一次保存。
 *
 * @param {unknown} payload 需要保存的数据
 */
function saveSessionWithKeepalive(payload) {
  fetch("/api/session/current", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ session: payload }),
    keepalive: true
  }).catch(() => undefined);
}

export default function App() {
  const [session, setSession] = useState(createFallbackSession);
  const [historySessions, setHistorySessions] = useState([]);
  const [selectedArchive, setSelectedArchive] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [saveState, setSaveState] = useState({ status: "loading", savedAt: null });
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [isDeletingArchive, setIsDeletingArchive] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [modalImageSource, setModalImageSource] = useState("");
  const [timerEndNotice, setTimerEndNotice] = useState(false);
  const [isImageOverlayVisible, setIsImageOverlayVisible] = useState(false);

  const fileInputRef = useRef(null);
  const saveTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const sessionRef = useRef(session);
  const isHydratedRef = useRef(false);
  const localImageObjectUrlRef = useRef("");
  const imageOverlayTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  const wordCount = useMemo(() => countWords(session.draftText), [session.draftText]);
  const saveStatusLabel = useMemo(() => resolveSaveStatusLabel(saveState), [saveState]);
  const saveStatusTitle = useMemo(() => resolveSaveStatusTitle(saveState), [saveState]);
  const currentImageSource = imagePreviewUrl || session.imagePath;
  const filteredHistorySessions = useMemo(
    () =>
      historySessions.filter((historySession) =>
        matchesPromptSourceFilter(historySession, historyFilter)
      ),
    [historyFilter, historySessions]
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    document.documentElement.dataset.theme = session.theme;
  }, [session.theme]);

  useEffect(() => {
    return () => {
      if (localImageObjectUrlRef.current) {
        URL.revokeObjectURL(localImageObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imageOverlayTimerRef.current) {
        clearTimeout(imageOverlayTimerRef.current);
        imageOverlayTimerRef.current = null;
      }
    };
  }, []);

  /**
   * 读取历史列表。
   *
   * @returns {Promise<void>}
   */
  const refreshHistorySessions = useCallback(async () => {
    const payload = await requestJson("/api/sessions");
    setHistorySessions(payload.sessions);

    if (!payload.sessions.length) {
      setSelectedArchive(null);
    }
  }, []);

  /**
   * 立即保存当前会话。
   *
   * @param {typeof session} nextSession 需要保存的会话对象
   * @returns {Promise<void>}
   */
  const saveSessionNow = useCallback(async (nextSession) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    setSaveState((previousState) => ({
      ...previousState,
      status: "saving"
    }));

    try {
      const payload = await requestJson("/api/session/current", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ session: nextSession })
      });

      sessionRef.current = payload.session;
      setSession(payload.session);
      setSaveState({
        status: "saved",
        savedAt: Date.now()
      });
    } catch (error) {
      console.error(error);
      setSaveState({
        status: "error",
        savedAt: null
      });
    }
  }, []);

  /**
   * 安排一次延迟自动保存。
   *
   * @param {typeof session} nextSession 需要保存的会话对象
   */
  const scheduleSave = useCallback(
    (nextSession) => {
      if (!isHydratedRef.current) {
        return;
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      setSaveState((previousState) => ({
        ...previousState,
        status: "saving"
      }));

      saveTimerRef.current = setTimeout(() => {
        void saveSessionNow(nextSession);
      }, AUTO_SAVE_DELAY);
    },
    [saveSessionNow]
  );

  /**
   * 按指定持久化策略更新当前会话。
   *
   * @param {(previousSession: typeof session) => typeof session} updater 会话更新函数
   * @param {"none" | "debounced" | "immediate"} persistMode 持久化模式
   */
  const updateSession = useCallback(
    (updater, persistMode = "debounced") => {
      setSession((previousSession) => {
        const nextSession = updater(previousSession);
        sessionRef.current = nextSession;

        if (persistMode === "immediate") {
          void saveSessionNow(nextSession);
        } else if (persistMode === "debounced") {
          scheduleSave(nextSession);
        }

        return nextSession;
      });
    },
    [saveSessionNow, scheduleSave]
  );

  useEffect(() => {
    /**
     * 初始化页面数据。
     *
     * @returns {Promise<void>}
     */
    async function bootstrapApplication() {
      try {
        const [sessionPayload] = await Promise.all([
          requestJson("/api/session/current"),
          refreshHistorySessions()
        ]);

        setSession(sessionPayload.session);
        setImagePreviewUrl("");
        sessionRef.current = sessionPayload.session;
        setSaveState({
          status: "saved",
          savedAt: Date.now()
        });
      } catch (error) {
        console.error(error);
        setSaveState({
          status: "error",
          savedAt: null
        });
      } finally {
        isHydratedRef.current = true;
        setIsBootstrapping(false);
      }
    }

    void bootstrapApplication();

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [refreshHistorySessions]);

  useEffect(() => {
    /**
     * 页面关闭前触发最后一次草稿保存，并在存在未归档内容时给出离开提醒。
     *
     * @param {BeforeUnloadEvent} event 关闭前事件
     */
    function handleBeforeUnload(event) {
      saveSessionWithKeepalive(sessionRef.current);

       if (hasUnarchivedProgress(sessionRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (session.timerStatus !== "running") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setSession((previousSession) => {
        if (previousSession.timerStatus !== "running") {
          return previousSession;
        }

        if (previousSession.remainingSeconds <= 1) {
          const completedSession = {
            ...previousSession,
            remainingSeconds: 0,
            timerStatus: "idle",
            updatedAt: new Date().toISOString()
          };

          sessionRef.current = completedSession;
          setTimerEndNotice(true);
          void saveSessionNow(completedSession);
          return completedSession;
        }

        const nextSession = {
          ...previousSession,
          remainingSeconds: previousSession.remainingSeconds - 1,
          updatedAt: new Date().toISOString()
        };

        sessionRef.current = nextSession;
        return nextSession;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [saveSessionNow, session.timerStatus]);

  useEffect(() => {
    document.title = timerEndNotice ? "时间到 - IELTS Scribe" : "IELTS Scribe";

    return () => {
      document.title = "IELTS Scribe";
    };
  }, [timerEndNotice]);

  useEffect(() => {
    /**
     * 监听全局粘贴事件，仅在检测到图片时接管粘贴流程。
     *
     * @param {ClipboardEvent} event 粘贴事件
     */
    function handleWindowPaste(event) {
      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));

      if (!imageItem) {
        return;
      }

      const imageFile = imageItem.getAsFile();

      if (!imageFile) {
        return;
      }

      event.preventDefault();
      void uploadImage(imageFile);
    }

    window.addEventListener("paste", handleWindowPaste);

    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [session.sessionId]);

  /**
   * 上传图片并写入当前会话。
   *
   * @param {File} file 图片文件
   * @returns {Promise<void>}
   */
  async function uploadImage(file) {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("sessionId", sessionRef.current.sessionId);

    setIsImageUploading(true);
    setIsImageOverlayVisible(true);
    if (imageOverlayTimerRef.current) {
      clearTimeout(imageOverlayTimerRef.current);
      imageOverlayTimerRef.current = null;
    }

    if (localImageObjectUrlRef.current) {
      URL.revokeObjectURL(localImageObjectUrlRef.current);
    }

    localImageObjectUrlRef.current = URL.createObjectURL(file);
    setImagePreviewUrl(localImageObjectUrlRef.current);

    try {
      const payload = await requestJson("/api/images", {
        method: "POST",
        body: formData
      });

      if (localImageObjectUrlRef.current) {
        URL.revokeObjectURL(localImageObjectUrlRef.current);
        localImageObjectUrlRef.current = "";
      }

      setImagePreviewUrl("");
      updateSession(
        (previousSession) => ({
          ...previousSession,
          imagePath: payload.imagePath,
          updatedAt: new Date().toISOString()
        }),
        "immediate"
      );

      // 上传成功后给浮层留 ~2s 反馈时间，再淡出避免遮挡图片
      imageOverlayTimerRef.current = setTimeout(() => {
        imageOverlayTimerRef.current = null;
        setIsImageOverlayVisible(false);
      }, IMAGE_OVERLAY_DISMISS_DELAY_MS);
    } catch (error) {
      console.error(error);
      setSaveState({
        status: "error",
        savedAt: null
      });
      setIsImageOverlayVisible(false);
    } finally {
      setIsImageUploading(false);
    }
  }

  /**
   * 处理文本输入变化。
   *
   * @param {React.ChangeEvent<HTMLTextAreaElement>} event 文本域事件
   */
  function handleDraftChange(event) {
    const nextDraftText = event.target.value;

    updateSession(
      (previousSession) => ({
        ...previousSession,
        draftText: nextDraftText,
        updatedAt: new Date().toISOString()
      }),
      "debounced"
    );
  }

  /**
   * 处理题目来源输入变化。
   *
   * @param {React.ChangeEvent<HTMLInputElement>} event 输入事件
   */
  function handlePromptSourceChange(event) {
    const nextPromptSource = event.target.value;

    updateSession(
      (previousSession) => ({
        ...previousSession,
        promptSource: nextPromptSource,
        updatedAt: new Date().toISOString()
      }),
      "debounced"
    );
  }

  /**
   * 切换计时模式并重置剩余时间。
   *
   * @param {20 | 40} nextMode 新模式
   */
  function handleTimerModeChange(nextMode) {
    setTimerEndNotice(false);
    updateSession(
      (previousSession) => ({
        ...previousSession,
        timerMode: nextMode,
        remainingSeconds: nextMode * 60,
        timerStatus: "idle",
        startedAt: null,
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 启动或继续当前计时器。
   */
  function handleStartOrResumeTimer() {
    setTimerEndNotice(false);
    updateSession(
      (previousSession) => ({
        ...previousSession,
        timerStatus: "running",
        startedAt: previousSession.startedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 暂停计时器，并立即保存时间快照。
   */
  function handlePauseTimer() {
    updateSession(
      (previousSession) => ({
        ...previousSession,
        timerStatus: "paused",
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 将当前计时器重置为初始剩余时间。
   */
  function handleResetTimer() {
    setTimerEndNotice(false);
    updateSession(
      (previousSession) => ({
        ...previousSession,
        remainingSeconds: previousSession.timerMode * 60,
        timerStatus: "idle",
        startedAt: null,
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 切换字数统计显隐。
   */
  function handleToggleWordCount() {
    updateSession(
      (previousSession) => ({
        ...previousSession,
        wordCountVisible: !previousSession.wordCountVisible,
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 切换深浅色主题。
   */
  function handleToggleTheme() {
    updateSession(
      (previousSession) => ({
        ...previousSession,
        theme: previousSession.theme === "dark" ? "light" : "dark",
        updatedAt: new Date().toISOString()
      }),
      "immediate"
    );
  }

  /**
   * 触发本地文件选择器。
   */
  function handleSelectImageClick() {
    fileInputRef.current?.click();
  }

  /**
   * 处理本地图片文件选择。
   *
   * @param {React.ChangeEvent<HTMLInputElement>} event 文件输入事件
   */
  function handleFileInputChange(event) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    void uploadImage(selectedFile);
    event.target.value = "";
  }

  /**
   * 拉取某条历史记录详情，并在抽屉中展示。
   *
   * @param {string} sessionId 历史会话 ID
   * @returns {Promise<void>}
   */
  async function handleSelectArchive(sessionId) {
    try {
      const payload = await requestJson(`/api/sessions/${sessionId}`);
      setSelectedArchive(payload.session);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * 归档当前练习并开始下一篇。
   *
   * @returns {Promise<void>}
   */
  async function handleArchiveAndCreateNext() {
    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      setSaveState({
        status: "saving",
        savedAt: null
      });

      const payload = await requestJson("/api/session/archive", {
        method: "POST"
      });

      setSession(payload.current);
      sessionRef.current = payload.current;
      setSelectedArchive(payload.archived);
      setTimerEndNotice(false);
      setSaveState({
        status: "saved",
        savedAt: Date.now()
      });
      await refreshHistorySessions();
      setIsHistoryOpen(true);
    } catch (error) {
      console.error(error);
      setSaveState({
        status: "error",
        savedAt: null
      });
    }
  }

  /**
   * 删除当前选中的历史记录，并在删除前要求用户二次确认。
   *
   * @returns {Promise<void>}
   */
  async function handleDeleteSelectedArchive() {
    if (!selectedArchive || isDeletingArchive) {
      return;
    }

    const shouldDelete = window.confirm("确认永久删除这条历史记录吗？此操作不可撤销。");

    if (!shouldDelete) {
      return;
    }

    setIsDeletingArchive(true);

    try {
      await requestJson(`/api/sessions/${selectedArchive.sessionId}`, {
        method: "DELETE"
      });

      if (modalImageSource && modalImageSource === selectedArchive.imagePath) {
        setModalImageSource("");
        setIsImagePreviewOpen(false);
      }

      setSelectedArchive(null);
      await refreshHistorySessions();
    } catch (error) {
      console.error(error);
      window.alert("删除失败，请稍后重试。");
    } finally {
      setIsDeletingArchive(false);
    }
  }

  /**
   * 创建新的空白练习，不归档当前内容。
   */
  function handleCreateBlankSession() {
    if (hasUnarchivedProgress(sessionRef.current)) {
      const shouldDiscardCurrentSession = window.confirm(
        "当前练习尚未归档。确认新建空白练习吗？当前内容不会进入历史记录。"
      );

      if (!shouldDiscardCurrentSession) {
        return;
      }
    }

    if (localImageObjectUrlRef.current) {
      URL.revokeObjectURL(localImageObjectUrlRef.current);
      localImageObjectUrlRef.current = "";
    }

    setImagePreviewUrl("");
    setTimerEndNotice(false);
    updateSession(
      () => ({
        ...createFallbackSession(),
        timerMode: 20,
        remainingSeconds: 20 * 60,
        wordCountVisible: sessionRef.current.wordCountVisible,
        theme: sessionRef.current.theme
      }),
      "immediate"
    );
  }

  const remainingTimeText = formatTime(session.remainingSeconds);
  const isRunning = session.timerStatus === "running";
  const hasImage = Boolean(currentImageSource);
  const selectedArchiveExcerpt = selectedArchive ? buildDraftExcerpt(selectedArchive.draftText) : "";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-copy">
          <p className="app-eyebrow">IELTS Writing Simulator</p>
          <h1>IELTS Scribe</h1>
          <p className="app-subtitle">
            左图右文的本地机考写作工作台，支持自动保存、双主题和历史归档。
          </p>
        </div>
        <div className="header-status">
          <button
            className="theme-toggle-button"
            onClick={handleToggleTheme}
            aria-label={session.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            title={session.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          >
            <span className="theme-toggle-track" aria-hidden="true">
              <span className="theme-toggle-icon theme-toggle-icon-sun">
                <svg viewBox="0 0 24 24" focusable="false">
                  <circle cx="12" cy="12" r="4"></circle>
                  <path d="M12 2.5v2.2M12 19.3v2.2M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2.5 12h2.2M19.3 12h2.2M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56"></path>
                </svg>
              </span>
              <span className="theme-toggle-icon theme-toggle-icon-moon">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20.2 14.2A8.7 8.7 0 1 1 9.8 3.8 7.1 7.1 0 0 0 20.2 14.2Z"></path>
                </svg>
              </span>
            </span>
          </button>
          <span
            className={`save-indicator status-${saveState.status}`}
            title={saveStatusTitle}
            aria-label={saveStatusTitle}
          >
            <span className="save-indicator-dot" aria-hidden="true"></span>
            <span>{saveStatusLabel}</span>
          </span>
          <button className="ghost-button" onClick={() => setIsHistoryOpen((value) => !value)}>
            {isHistoryOpen ? "关闭历史" : "打开历史"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="prompt-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">Prompt Board</p>
              <h2>题目图片区</h2>
            </div>
            <div className="panel-actions">
              {hasImage ? (
                <button
                  className="ghost-button"
                  onClick={() => {
                    setModalImageSource(currentImageSource);
                    setIsImagePreviewOpen(true);
                  }}
                >
                  放大预览
                </button>
              ) : null}
              <button className="ghost-button" onClick={handleSelectImageClick}>
                {hasImage ? "替换图片" : "上传图片"}
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileInputChange}
            />
          </div>

          <div className="prompt-source-field">
            <div className="prompt-source-group">
              <input
                id="prompt-source"
                className="prompt-source-input"
                type="text"
                placeholder=" "
                value={session.promptSource}
                onChange={handlePromptSourceChange}
              />
              <span className="prompt-source-highlight" aria-hidden="true"></span>
              <span className="prompt-source-bar" aria-hidden="true"></span>
              <label className="prompt-source-label" htmlFor="prompt-source">
                题目来源
              </label>
            </div>
          </div>

          <div className={`image-dropzone ${hasImage ? "has-image" : ""}`}>
            {hasImage ? (
              <>
                <img className="prompt-image" src={currentImageSource} alt="题目图片预览" />
                <div
                  className={`image-overlay ${isImageOverlayVisible ? "is-visible" : "is-hidden"}`}
                  aria-hidden={!isImageOverlayVisible}
                >
                  <div className="image-overlay-copy">
                    <strong>{isImageUploading ? "正在写入题目图…" : "题目图已加载"}</strong>
                    <span>
                      {isImageUploading
                        ? "正在保存到项目目录，保存完成后可继续沿用。"
                        : "点击右上角可替换图片，点击“放大预览”查看细节。"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="image-empty-state">
                <div className="image-placeholder" />
                <strong>{isImageUploading ? "正在上传图片..." : "粘贴题目图片"}</strong>
                <span>支持 Cmd/Ctrl + V，或点击右上角上传单张图片。</span>
              </div>
            )}
          </div>
        </section>

        <section className="editor-panel">
          <div className="toolbar">
            <div className="toolbar-group">
              <button
                className={`mode-button ${session.timerMode === 20 ? "active" : ""}`}
                onClick={() => handleTimerModeChange(20)}
              >
                20 min
              </button>
              <button
                className={`mode-button ${session.timerMode === 40 ? "active" : ""}`}
                onClick={() => handleTimerModeChange(40)}
              >
                40 min
              </button>
            </div>

            <div className="toolbar-group">
              <button className="primary-button" onClick={handleStartOrResumeTimer}>
                {isRunning ? "运行中" : session.timerStatus === "paused" ? "继续" : "开始"}
              </button>
              <button className="ghost-button" onClick={handlePauseTimer} disabled={!isRunning}>
                暂停
              </button>
              <button className="ghost-button" onClick={handleResetTimer}>
                重置
              </button>
            </div>

            <div className="toolbar-group toolbar-metrics">
              <span className={`timer-display ${session.remainingSeconds <= 60 ? "danger" : ""}`}>
                {remainingTimeText}
              </span>
              <button className="ghost-button" onClick={handleToggleWordCount}>
                {session.wordCountVisible ? "隐藏字数" : "显示字数"}
              </button>
            </div>
          </div>

          {timerEndNotice ? (
            <div className="timer-notice" role="status" aria-live="polite">
              <div>
                <strong>计时结束</strong>
                <span>本轮写作已到时。你可以归档当前内容，或重置后继续练习。</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setTimerEndNotice(false)}
              >
                知道了
              </button>
            </div>
          ) : null}

          <div className="editor-actions">
            <button className="ghost-button" onClick={handleArchiveAndCreateNext}>
              结束并归档
            </button>
            <button className="ghost-button" onClick={handleCreateBlankSession}>
              新建空白
            </button>
          </div>

          <label className="editor-label" htmlFor="writing-area">
            Writing Area
          </label>
          <textarea
            id="writing-area"
            className="writing-area"
            placeholder={isBootstrapping ? "正在加载草稿..." : "Start writing here..."}
            value={session.draftText}
            onChange={handleDraftChange}
          />

          <div className="editor-footer">
            <div className="editor-footer-left">
              <span>当前会话：{session.sessionId.slice(0, 18)}</span>
              <span>模式：Task {session.timerMode === 20 ? "1" : "2"} 练习</span>
            </div>
            <div className="editor-footer-right">
              {session.wordCountVisible ? <span>Words {wordCount}</span> : <span>Words hidden</span>}
            </div>
          </div>
        </section>
      </main>

      <aside className={`history-drawer ${isHistoryOpen ? "open" : ""}`}>
        <div className="drawer-header">
          <div>
            <p className="panel-eyebrow">History</p>
            <h2>历史练习</h2>
          </div>
          <button className="ghost-button" onClick={() => void refreshHistorySessions()}>
            刷新
          </button>
        </div>

        <div className="history-filter">
          <input
            className="history-filter-input"
            type="text"
            placeholder="按题目来源筛选历史记录"
            value={historyFilter}
            onChange={(event) => setHistoryFilter(event.target.value)}
          />
        </div>

        <div className="history-body">
          <div className="history-list">
            {filteredHistorySessions.length ? (
              filteredHistorySessions.map((item) => (
                <button
                  key={item.sessionId}
                  className={`history-item ${
                    selectedArchive?.sessionId === item.sessionId ? "selected" : ""
                  }`}
                  onClick={() => void handleSelectArchive(item.sessionId)}
                >
                  <div className="history-item-top">
                    <strong>{formatDateTime(item.endedAt)}</strong>
                    <span className="history-badge">{resolvePracticeLabel(item.timerMode)}</span>
                  </div>
                  <div className="history-item-metrics">
                    <span>{item.wordCount} words</span>
                    <span>{item.imagePath ? "含题目图" : "无题目图"}</span>
                  </div>
                  <span className="history-source">{resolvePromptSourceLabel(item.promptSource)}</span>
                  <span>{buildDraftExcerpt(item.draftText)}</span>
                </button>
              ))
            ) : (
              <div className="history-empty">
                {historySessions.length ? "没有匹配的题目来源记录。" : "暂无历史练习记录。"}
              </div>
            )}
          </div>

          <div className="history-detail">
            {selectedArchive ? (
              <>
                <div className="history-detail-head">
                  <div>
                    <p className="panel-eyebrow">Archived Session</p>
                    <h3>{formatDateTime(selectedArchive.endedAt)}</h3>
                  </div>
                  <div className="history-detail-actions">
                    <span className="history-badge">{resolvePracticeLabel(selectedArchive.timerMode)}</span>
                    <button
                      className="ghost-button danger-button"
                      onClick={() => void handleDeleteSelectedArchive()}
                      disabled={isDeletingArchive}
                      type="button"
                    >
                      {isDeletingArchive ? "删除中..." : "删除这条记录"}
                    </button>
                  </div>
                </div>

                <div className="history-meta">
                  <span>题目来源：{resolvePromptSourceLabel(selectedArchive.promptSource)}</span>
                  <span>字数：{selectedArchive.wordCount}</span>
                  <span>剩余时间：{formatTime(selectedArchive.remainingSeconds)}</span>
                </div>

                <div className="history-summary-card">
                  <strong>摘要</strong>
                  <p>{selectedArchiveExcerpt}</p>
                </div>

                <div className="history-detail-grid">
                  <div className="history-detail-panel">
                    <h4>正文内容</h4>
                    <pre>{selectedArchive.draftText || "这条记录未包含正文内容。"}</pre>
                  </div>

                  <div className="history-detail-panel image-panel">
                    <h4>题目图片</h4>
                    {selectedArchive.imagePath ? (
                      <button
                        className="history-image-button"
                        onClick={() => {
                          setModalImageSource(selectedArchive.imagePath);
                          setIsImagePreviewOpen(true);
                        }}
                        type="button"
                      >
                        <img src={selectedArchive.imagePath} alt="历史记录题目图" />
                      </button>
                    ) : (
                      <div className="history-image-empty">这条记录没有保存题目图片。</div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="history-empty">选择左侧记录查看详情。</div>
            )}
          </div>
        </div>
      </aside>

      {isImagePreviewOpen && modalImageSource ? (
        <div className="image-modal-backdrop" onClick={() => setIsImagePreviewOpen(false)}>
          <div className="image-modal" onClick={(event) => event.stopPropagation()}>
            <div className="image-modal-header">
              <div>
                <p className="panel-eyebrow">Image Preview</p>
                <h3>题目图片放大预览</h3>
              </div>
              <button className="ghost-button" onClick={() => setIsImagePreviewOpen(false)}>
                关闭
              </button>
            </div>
            <div className="image-modal-body">
              <img src={modalImageSource} alt="放大题目图片预览" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
