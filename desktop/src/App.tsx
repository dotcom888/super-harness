import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { PanelRight } from "lucide-react";
import { DevToolsSidebar } from "./components/DevToolsSidebar";
import { WindowControls } from "./components/WindowControls";
import { EmptyState } from "./components/EmptyState";
import { ActionItem } from "./components/ActionItem";
import { ChatMessage } from "./components/ChatMessage";
import { TaskDrawer } from "./components/TaskDrawer";
import { BottomInput } from "./components/BottomInput";
import { FileViewerModal } from "./components/FileViewerModal";
import { SettingsModal } from "./components/SettingsModal";
import { PluginsModal } from "./components/PluginsModal";
import { ApprovalModal } from "./components/ApprovalModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { SessionInfo, ProjectInfo, ToolAction, TaskItem, TurnData, TrajectoryStep, AttachmentItem, UserInputRequest } from "./types";
import { TurnRuler } from "./components/TurnRuler";
import { UserInputModal } from "./components/UserInputModal";
import { TrajectoryTimeline } from "./components/TrajectoryTimeline";
import { LOGO_DATA_URI } from "./assets/logoData";
import { InputContextMenu, ContextMenuPosition } from "./components/InputContextMenu";
import { readMediaFromClipboard } from "./utils/clipboardHelper";
import { normalizeModeId, getModeDisplayName } from "./utils/modeHelper";

// 生成复合工程与会话键，保证跨项目及同项目多会话 100% 独立隔离
const getSessionKey = (proj: string, sid: string) => `${proj || "default"}:${sid || "default"}`;

export const App: React.FC = () => {
  // 侧边栏与弹窗状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "trace">("chat");

  // 调试侧边栏会话级隔离状态 (对标需求 5：侧边栏归属于当前对话框，切换会话时自动隔离并记忆)
  const [sessionDevToolsOpenMap, setSessionDevToolsOpenMap] = useState<Record<string, boolean>>({});
  const [sessionDevToolsTabsMap, setSessionDevToolsTabsMap] = useState<Record<string, any[]>>({});
  const [sessionDevToolsActiveTabMap, setSessionDevToolsActiveTabMap] = useState<Record<string, string | null>>({});
  const [sessionTerminalOutputsMap, setSessionTerminalOutputsMap] = useState<Record<string, Record<string, string[]>>>({});
  const [sessionDevToolsMaximizedMap, setSessionDevToolsMaximizedMap] = useState<Record<string, boolean>>({});

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [approvalReq, setApprovalReq] = useState<{ ticket_id: string; command: string; reason: string } | null>(null);
  const [userInputReq, setUserInputReq] = useState<UserInputRequest | null>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // 多工程工作区状态 (扫描包含 4 个项目的全部历史消息)
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("default");
  const [sessionTitle, setSessionTitle] = useState("默认会话");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionInfo[]>([]);

  // 模型状态 (仅同步有效配置的模型，支持自定义映射)
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelProviders, setModelProviders] = useState<Record<string, string>>({});
  const [currentModel, setCurrentModel] = useState("");
  const [settingsInitialTab, setSettingsInitialTab] = useState<"models" | "security" | "general" | "about">("models");
  const [modeName, setModeName] = useState("Auto 模式");

  // 外观主题状态 (浅色为当前默认背景色，深色为护眼深黑)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("super_theme") as "light" | "dark") || "light";
  });

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("super_theme", theme);
  }, [theme]);

  // 界面字号多级控制 (0: 小-15px, 1: 默认-17px, 2: 中-18.5px, 3: 大-20px, 4: 特大-21.5px)
  const FONT_SIZES = [15, 17, 18.5, 20, 21.5];
  const [fontSizeLevel, setFontSizeLevel] = useState<number>(() => {
    const saved = localStorage.getItem("super_font_size");
    return saved !== null ? Number(saved) : 1; // 初始值为 1 (默认放大一档)
  });

  useEffect(() => {
    const size = FONT_SIZES[fontSizeLevel] || 17;
    document.documentElement.style.fontSize = `${size}px`;
    localStorage.setItem("super_font_size", String(fontSizeLevel));
  }, [fontSizeLevel]);

  // 多会话独立状态隔离字典 (按照 project:session_id 绝对隔离)
  const [hasStarted, setHasStarted] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(true);
  const [sessionTurnsMap, setSessionTurnsMap] = useState<Record<string, TurnData[]>>({});
  const [sessionActionsMap, setSessionActionsMap] = useState<Record<string, ToolAction[]>>({});
  const [sessionThoughtMap, setSessionThoughtMap] = useState<Record<string, string>>({});
  const [runningSessions, setRunningSessions] = useState<Record<string, boolean>>({});
  const [draftPrompt, setDraftPrompt] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<number | null>(null);
  const scrollSpyRafRef = useRef<number | null>(null);

  // 当前激活会话的复合键与派生状态 (优先就绪，消除 TDZ)
  const currentSessionKey = getSessionKey(projectName, activeSessionId);

  // 调试侧边栏当前激活状态派生 (归属于当前对话框，对标需求 5)
  const isDevToolsOpen = Boolean(sessionDevToolsOpenMap[currentSessionKey]);
  const isDevToolsMaximized = Boolean(sessionDevToolsMaximizedMap[currentSessionKey]);
  const currentDevToolsTabs = sessionDevToolsTabsMap[currentSessionKey] || [];
  const currentDevToolsActiveTabId = sessionDevToolsActiveTabMap[currentSessionKey] || null;
  const currentTerminalOutputs = sessionTerminalOutputsMap[currentSessionKey] || {};

  const turns = sessionTurnsMap[currentSessionKey] || [];

  useEffect(() => {
    if (turns.length > 0) {
      setActiveTurnId((prev) => {
        if (prev === null || !turns.some((t) => t.turn_id === prev)) {
          return turns[turns.length - 1].turn_id;
        }
        return prev;
      });
    } else {
      setActiveTurnId(null);
    }
  }, [turns]);
  const actions = sessionActionsMap[currentSessionKey] || [];
  const thoughtText = sessionThoughtMap[currentSessionKey] || "";
  const isCurrentSessionLoading = Boolean(runningSessions[currentSessionKey]);
  // 综合判定当前会话是否处于对话态 (在途轮次 > 0 或正在流式运行中时绝对锁定对话视图，杜绝误闪回空态)
  const isCurrentChatStarted = hasStarted || turns.length > 0 || isCurrentSessionLoading;

  // 视口与滚动 DOM Refs 统一最前置声明，彻底根除 TDZ (Cannot access before initialization)


  const wsRef = useRef<WebSocket | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const sessionScrollMap = useRef<Record<string, number>>({});
  const lastScrolledSessionRef = useRef<string | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const isRestoringScrollRef = useRef<boolean>(false);
  const handleToggleDevTools = () => {
    const el = chatContainerRef.current;
    const wasAtBottom = el ? (el.scrollHeight - el.scrollTop - el.clientHeight <= 150) : true;
    if (wasAtBottom) {
      isAtBottomRef.current = true;
    }
    const nextOpen = !sessionDevToolsOpenMap[currentSessionKey];
    setSessionDevToolsOpenMap((prev) => ({
      ...prev,
      [currentSessionKey]: nextOpen
    }));
    // 每次点击打开侧边栏时，统一重置为默认大小 (非放大全屏状态)
    if (nextOpen) {
      setSessionDevToolsMaximizedMap((prev) => ({
        ...prev,
        [currentSessionKey]: false
      }));
    }
    if (wasAtBottom) {
      setTimeout(() => {
        if (chatContainerRef.current && isAtBottomRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  };

  // 监听主视口尺寸重绘：当侧边栏开关或拖拽缩放导致宽度改变时，若原本停留在底部则平滑锁底，防止视口跳动
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (isAtBottomRef.current && el) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isCurrentChatStarted]);

  useLayoutEffect(() => {
    const el = chatContainerRef.current;
    if (!el || !isCurrentChatStarted) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (el && isAtBottomRef.current) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
  }, [isDevToolsOpen, isDevToolsMaximized, isCurrentChatStarted]);

  // 同步 Refs 供长连 WebSocket 内部安全读取活跃态，消除闭包陈旧
  const activeSessionIdRef = useRef(activeSessionId);
  const projectNameRef = useRef(projectName);
  const runningSessionsRef = useRef(runningSessions);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  useEffect(() => {
    runningSessionsRef.current = runningSessions;
  }, [runningSessions]);

  // 吸底滚动：仅当用户确实停留在页面最底部时随思考步骤/工具调用同步下移，在翻看历史时严格保持视图不动 (对标需求 3)
  const autoScrollIfAtBottom = () => {
    if (!isAtBottomRef.current || !chatContainerRef.current) return;
    requestAnimationFrame(() => {
      if (isAtBottomRef.current && chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    });
  };

  // 轮次尺点击定位平滑跳转
  const handleScrollToTurn = (turnId: number) => {
    setActiveTurnId(turnId);
    const el = document.getElementById(`turn-user-${turnId}`) || document.getElementById(`turn-container-${turnId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (chatContainerRef.current) {
        const c = chatContainerRef.current;
        isAtBottomRef.current = c.scrollHeight - c.scrollTop - c.clientHeight <= 150;
      }
    }
  };

  // 动态切换运行安全模式 (支持在思考执行过程中即时生效)
  const handlePermissionChange = (newMode: string) => {
    setModeName(newMode);
    const permVal = normalizeModeId(newMode);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "set_permission_mode",
          permission_mode: permVal,
          session_id: activeSessionId,
          project_name: projectName
        })
      );
    }
    fetch("http://127.0.0.1:8765/api/permission_mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: permVal })
    }).catch(() => {});
  };

  // 敏感命令人工审批提交
  const handleResolveApproval = (ticketId: string, approved: boolean, trustSession: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "approval_response",
          ticket_id: ticketId,
          approved: approved,
          trust_session: trustSession,
          session_id: activeSessionId,
          project_name: projectName
        })
      );
    }
    fetch("http://127.0.0.1:8765/api/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: ticketId, approved, trust_session: trustSession })
    }).catch(() => {});
    setApprovalReq(null);
  };

  // 用户交互方案确认提交
  const handleResolveUserInput = (requestId: string, selectedOption: string, customInput: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "user_input_response",
          request_id: requestId,
          selected_option: selectedOption,
          custom_input: customInput,
          session_id: activeSessionId,
          project_name: projectName
        })
      );
    }
    fetch("http://127.0.0.1:8765/api/user_input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, selected_option: selectedOption, custom_input: customInput })
    }).catch(() => {});
    setUserInputReq(null);
  };

  const handleCancelUserInput = (requestId: string) => {
    handleResolveUserInput(requestId, "", "【用户取消操作】");
  };




  // 会话输入草稿与文件附件临时保护系统 (包括聊天框与新增会话页面，杜绝切换丢失)
  const [sessionDraftsMap, setSessionDraftsMap] = useState<Record<string, { text: string; attachments: AttachmentItem[] }>>({});
  const [newSessionDraft, setNewSessionDraft] = useState<{ text: string; attachments: AttachmentItem[] }>(() => {
    try {
      const saved = localStorage.getItem("super_new_session_draft");
      return saved ? JSON.parse(saved) : { text: "", attachments: [] };
    } catch {
      return { text: "", attachments: [] };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("super_new_session_draft", JSON.stringify(newSessionDraft));
    } catch {}
  }, [newSessionDraft]);


  // 全局阻止默认拖拽行为，防止 Electron 误将拖入窗口边缘的文件作为网页打开
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", handleGlobalDragOver);
    window.addEventListener("drop", handleGlobalDrop);
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("drop", handleGlobalDrop);
    };
  }, []);

  // 1. 初始化加载所有工作区项目、有效模型列表与活跃会话 (若后端正在启动，持续轮询重试直至成功获取真实项目与历史)
  useEffect(() => {
    fetchModels();
    fetchWorkspaces();

    // 保底机制：若极端网络异常导致会话历史未返回，2.5s 后强制淡出启动 Logo 屏
    const splashFallback = setTimeout(() => {
      if (typeof (window as any).__dismissSuperSplash === "function") {
        (window as any).__dismissSuperSplash();
      }
    }, 2500);

    const timer = setInterval(() => {
      setProjects((currentProjects) => {
        if (!currentProjects || currentProjects.length === 0 || (currentProjects.length === 1 && currentProjects[0].session_count === 0)) {
          fetchModels();
          fetchWorkspaces();
        } else {
          clearInterval(timer);
        }
        return currentProjects;
      });
    }, 1200);

    return () => { clearInterval(timer); clearTimeout(splashFallback); };
  }, []);

  // 动态测量聊天滚动区垂直滚动条宽度，写入 CSS 变量，供底部输入框做完全一致的宽度补偿
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const el = chatContainerRef.current;
      const sbw = el ? Math.max(0, el.offsetWidth - el.clientWidth) : 0;
      root.style.setProperty("--chat-scrollbar-w", `${sbw}px`);
    };
    measure();
    const raf = requestAnimationFrame(measure);

    const el = chatContainerRef.current;
    const observer = el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer && el) {
      observer.observe(el);
      const inner = el.firstElementChild;
      if (inner) observer.observe(inner);
    }
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--chat-scrollbar-w");
    };
  }, [isCurrentChatStarted, activeTab]);

  // 保持桌面端与本地 history/ 目录双向一致同步 (窗口重获焦点与后台定时轻量刷新)
  useEffect(() => {
    const handleSync = () => {
      fetchWorkspaces(projectNameRef.current, activeSessionIdRef.current, false);
    };

    window.addEventListener("focus", handleSync);
    const handleVis = () => {
      if (document.visibilityState === "visible") {
        handleSync();
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    const syncTimer = setInterval(handleSync, 3000);

    return () => {
      window.removeEventListener("focus", handleSync);
      document.removeEventListener("visibilitychange", handleVis);
      clearInterval(syncTimer);
    };
  }, []);

  const fetchModels = () => {
    fetch("http://127.0.0.1:8765/api/models")
      .then((res) => res.json())
      .then((data) => {
        const list = data.models || [];
        setAvailableModels(list);
        setCurrentModel(data.current_model || (list.length > 0 ? list[0] : ""));
        if (data.model_providers) {
          setModelProviders(data.model_providers);
        }
      })
      .catch(() => {});
  };

  const fetchWorkspaces = (targetProject?: string, targetSession?: string, shouldLoadSession: boolean = true) => {
    fetch("http://127.0.0.1:8765/api/workspaces")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        const projs: ProjectInfo[] = (data.projects || []).filter(
          (p: ProjectInfo) => !["_general", "workspace", "scratchpad", ".super-harness", ".super-harnes", "super-server", "bin", "resources", "_internal"].includes(p.name.toLowerCase())
        );
        const recents: SessionInfo[] = data.recent_sessions || [];
        setProjects(projs);
        setRecentSessions(recents);

        // 如果调用方明确要求不加载/不切换会话 (例如后台静默同步、删除其它会话、图钉更新等)
        // 且当前已有选中的项目和会话，绝对不要重置会话或跳转到其它项目！
        if (!shouldLoadSession && (activeSessionIdRef.current || targetSession)) {
          const currentProjName = targetProject || projectNameRef.current;
          if (targetProject && targetProject !== projectNameRef.current) {
            projectNameRef.current = targetProject;
            setProjectName(targetProject);
          }
          if (targetSession && targetSession !== activeSessionIdRef.current) {
            activeSessionIdRef.current = targetSession;
            setActiveSessionId(targetSession);
          }
          if (currentProjName === "_general") {
            setSessions(recents);
          } else {
            const matched = projs.find(
              (p) => p.name.toLowerCase() === currentProjName.toLowerCase()
            );
            if (matched) {
              setSessions(matched.sessions || []);
              if (matched.name !== projectNameRef.current) {
                setProjectName(matched.name);
              }
            }
          }
          return;
        }

        const desiredProj = targetProject || projectNameRef.current;
        if (desiredProj === "_general") {
          setProjectName("_general");
          setSessions(recents);
          const desiredSid = targetSession || activeSessionIdRef.current;
          const validSession = recents.find((s) => s.session_id === desiredSid);
          const sid = validSession ? validSession.session_id : (desiredSid && !shouldLoadSession ? desiredSid : (recents.length > 0 ? recents[0].session_id : "default"));
          setActiveSessionId(sid);

          if (!validSession && desiredSid && shouldLoadSession) {
            const delKey = getSessionKey("_general", desiredSid);
            setSessionTurnsMap((prev) => {
              if (!prev[delKey]) return prev;
              const next = { ...prev };
              delete next[delKey];
              return next;
            });
          }

          if (shouldLoadSession && recents.length > 0) {
            loadSessionTurns(sid, "_general");
          } else if (recents.length === 0 && !desiredSid) {
            setHasStarted(false);
          }
          return;
        }

        // 大小写不敏感安全匹配，避免因大小写差异误判为项目已被物理删除
        const matchedProj = projs.find(
          (p) => p.name.toLowerCase() === desiredProj.toLowerCase()
        );

        // 若目标项目已在磁盘上被物理删除，才自动回退到 _general 或首个有效项目
        if (desiredProj && desiredProj !== "_general" && !matchedProj) {
          if (recents.length > 0) {
            setProjectName("_general");
            setSessions(recents);
            setActiveSessionId(recents[0].session_id);
            if (shouldLoadSession) {
              loadSessionTurns(recents[0].session_id, "_general");
            }
          } else if (projs.length > 0) {
            setProjectName(projs[0].name);
            setSessions(projs[0].sessions || []);
            const firstSid = projs[0].sessions && projs[0].sessions.length > 0 ? projs[0].sessions[0].session_id : "default";
            setActiveSessionId(firstSid);
            if (shouldLoadSession && projs[0].sessions && projs[0].sessions.length > 0) {
              loadSessionTurns(firstSid, projs[0].name);
            } else {
              setHasStarted(false);
            }
          } else {
            setProjectName("_general");
            setSessions([]);
            setActiveSessionId("default");
            setHasStarted(false);
          }
          return;
        }

        if (projs.length === 0) {
          if (recents.length > 0) {
            setProjectName("_general");
            setSessions(recents);
            const validRec = recents.find((s) => s.session_id === targetSession);
            const sid = validRec ? validRec.session_id : recents[0].session_id;
            setActiveSessionId(sid);
            if (shouldLoadSession) {
              loadSessionTurns(sid, "_general");
            }
          } else {
            setProjectName("");
            setSessions([]);
            setActiveSessionId("default");
            setHasStarted(false);
            if (typeof (window as any).__dismissSuperSplash === "function") {
              (window as any).__dismissSuperSplash();
            }
          }
          return;
        }

        const currentProj = matchedProj ? matchedProj.name : (projs.length > 0 ? projs[0].name : "");
        setProjectName(currentProj);

        const currentProjObj = matchedProj || projs[0];
        const projSessions = currentProjObj?.sessions || [];
        setSessions(projSessions);

        const desiredSid = targetSession || activeSessionIdRef.current;
        const validSession = projSessions.find((s) => s.session_id === desiredSid);
        const sid = validSession ? validSession.session_id : (desiredSid && !shouldLoadSession ? desiredSid : (projSessions.length > 0 ? projSessions[0].session_id : "default"));
        setActiveSessionId(sid);

        if (!validSession && targetSession && shouldLoadSession) {
          const delKey = getSessionKey(currentProjObj ? currentProjObj.name : currentProj, targetSession);
          setSessionTurnsMap((prev) => {
            if (!prev[delKey]) return prev;
            const next = { ...prev };
            delete next[delKey];
            return next;
          });
        }

        if (shouldLoadSession) {
          if (projSessions.length > 0) {
            loadSessionTurns(sid, currentProjObj ? currentProjObj.name : currentProj);
          } else {
            setHasStarted(false);
          }
        }
      })
      .catch(() => {});
  };

  // 读取指定项目和会话的历史轮次 (智能保护内存中的在途轮次，杜绝二次发消息覆盖；支持 force 强制对齐)
  const loadSessionTurns = (sid: string, targetProj?: string, force = false) => {
    const proj = targetProj || projectName;
    const key = getSessionKey(proj, sid);

    fetch(`http://127.0.0.1:8765/api/sessions/turns?session_id=${encodeURIComponent(sid)}&project=${encodeURIComponent(proj)}`)
      .then((res) => {
        if (!res.ok) throw new Error("加载会话历史失败");
        return res.json();
      })
      .then((data) => {
        if (data.turns && data.turns.length > 0) {
          setHasStarted(true);
          setSessionTurnsMap((prev) => {
            const curList = prev[key] || [];
            // 若非强制刷新，且内存中已有轮次多于磁盘数据，绝对不能回退覆盖抹除最新对话气泡
            if (!force && curList.length > data.turns.length) {
              return prev;
            }
            if (force) {
              return { ...prev, [key]: data.turns };
            }
            // 深度合并轮次：若当前会话正在运行中，其最新一轮必须保留内存中的实时思考与响应，绝对不能被磁盘未完成状态覆盖
            const isCurrentlyRunning = Boolean(runningSessions[key] || (isCurrentSessionLoading && key === getSessionKey(projectNameRef.current, activeSessionIdRef.current)));
            const mergedTurns = data.turns.map((dTurn: TurnData, idx: number) => {
              const memoryTurn = curList[idx];
              if (memoryTurn && memoryTurn.turn_id === dTurn.turn_id) {
                const isLatestRunningTurn = isCurrentlyRunning && idx === data.turns.length - 1;
                return {
                  ...dTurn,
                  attachments: (dTurn.attachments && dTurn.attachments.length > 0) ? dTurn.attachments : (memoryTurn.attachments || []),
                  assistant_response: isLatestRunningTurn
                    ? (memoryTurn.assistant_response || "")
                    : (memoryTurn.assistant_response || dTurn.assistant_response || ""),
                  thought: isLatestRunningTurn
                    ? (memoryTurn.thought || "")
                    : (dTurn.thought || memoryTurn.thought || ""),
                  steps: (memoryTurn.steps && memoryTurn.steps.length > 0) ? memoryTurn.steps : (dTurn.steps || [])
                };
              }
              return dTurn;
            });
            return { ...prev, [key]: mergedTurns };
          });
          setSessionActionsMap((prev) => ({
            ...prev,
            [key]: data.all_actions || []
          }));
          setTasks(data.tasks || []);

          // 智能提取有效提问与标题：优先保留现有良好命名或首个非空提问，杜绝丢失标题
          const validTurn = (data.turns || []).find((t: any) => t.user_prompt && t.user_prompt.trim());
          const firstPrompt = validTurn?.user_prompt;
          const goal = data.working_memory?.current_goal;

          const currentItem = sessions.find((s) => s.session_id === sid);
          const existingTitle = currentItem && currentItem.current_goal && currentItem.current_goal !== sid
            ? currentItem.current_goal
            : null;

          const title = existingTitle || goal || (firstPrompt ? (firstPrompt.length > 28 ? firstPrompt.slice(0, 28) + "..." : firstPrompt) : (sid === "default" ? "默认会话" : "新会话"));
          setSessionTitle(title);

          const lastTurn = data.turns[data.turns.length - 1];
          if (lastTurn) {
            setSessionThoughtMap((prev) => ({
              ...prev,
              [key]: lastTurn.thought || lastTurn.assistant_response || ""
            }));
          }



          // 数据返回渲染后：若存在该会话离开时的历史滚动停留，精确恢复；若首次加载则平滑定位到最底部
          if (key === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
            const savedTop = sessionScrollMap.current[key];
            if (typeof savedTop === "number") {
              const el = chatContainerRef.current;
              if (el) {
                el.scrollTop = savedTop;
                const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 40;
                isAtBottomRef.current = atBottom;
                setShowScrollBottom(!atBottom);
              }
            } else {
              scrollToLatestTurn(true);
            }
          }
        } else {
          // 磁盘无历史轮次：检查内存中是否已有新发起的在途轮次，有则保留
          setSessionTurnsMap((prev) => {
            const curList = prev[key] || [];
            if (!force && curList.length > 0) return prev;
            return { ...prev, [key]: [] };
          });
          if (force) {
            setSessionActionsMap((prev) => ({ ...prev, [key]: [] }));
            setTasks([]);
            setHasStarted(false);
          }
          setSessionTurnsMap((prev) => {
            const curList = prev[key] || [];
            if (curList.length === 0 && key === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
              const currentProjObj = projects.find((p) => p.name === proj);
              const sessionList = currentProjObj ? currentProjObj.sessions : sessions;
              const targetSessionMeta = sessionList?.find((s) => s.session_id === sid);
              if (!targetSessionMeta || targetSessionMeta.turn_count === 0) {
                setHasStarted(false);
              }
            }
            return prev;
          });
          const currentProjObj = projects.find((p) => p.name === proj);
          const sessionList = currentProjObj ? currentProjObj.sessions : sessions;
          const targetSessionMeta = sessionList?.find((s) => s.session_id === sid);
          const titleToShow = targetSessionMeta?.title && targetSessionMeta.title !== sid
            ? targetSessionMeta.title
            : (sid === "default" ? "默认会话" : "新会话");
          setSessionTitle(titleToShow);
        }
      })
      .catch(() => {})
      .finally(() => {
        // 核心优化：首个会话历史真正加载并渲染到主视口后，才淡出启动 Logo 屏
        // 杜绝先显示 0.5s 空态页再突然跳转到会话界面的闪烁体验
        if (typeof (window as any).__dismissSuperSplash === "function") {
          (window as any).__dismissSuperSplash();
        }
      });
  };

  // 2. 建立长期持久的双工 WebSocket 实时监听 (挂载时仅初始化一次，绝不在切换会话/项目时重连打断)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isUnmounted = false;

    const connect = () => {
      try {
        ws = new WebSocket("ws://127.0.0.1:8765/ws");

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            const targetSid = payload.session_id || activeSessionIdRef.current;
            const targetProj = payload.project || projectNameRef.current;
            const targetKey = getSessionKey(targetProj, targetSid);

            if (payload.event === "connected") {
              fetchModels();
              fetchWorkspaces();
            } else if (payload.event === "approval_required") {
              setApprovalReq({
                ticket_id: payload.ticket_id,
                command: payload.command,
                reason: payload.reason
              });
            } else if (payload.event === "thought") {
              const thText = payload.thought || "";
              setSessionThoughtMap((prev) => ({
                ...prev,
                [targetKey]: thText
              }));
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const updated = [...list];
                const curTurn = updated[lastIdx];
                const curSteps = curTurn.steps || [];
                const newStep: TrajectoryStep = {
                  id: `th_${Date.now()}_${Math.random()}`,
                  type: "assistant",
                  thought: thText,
                  timestamp: Date.now()
                };
                updated[lastIdx] = {
                  ...curTurn,
                  thought: thText,
                  steps: [...curSteps, newStep]
                };
                return { ...prev, [targetKey]: updated };
              });
              if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                autoScrollIfAtBottom();
              }
            } else if (payload.event === "user_input_request") {
              setUserInputReq({
                request_id: payload.request_id,
                question: payload.question,
                header: payload.header,
                options: payload.options,
                allow_custom: payload.allow_custom,
                session_id: payload.session_id,
                project: payload.project
              });
              if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                autoScrollIfAtBottom();
              }
            } else if (payload.event === "tool_start" || payload.event === "tool_call_start") {
              const newAction: ToolAction = {
                id: payload.id || payload.tool_call_id || `act_${Date.now()}`,
                tool: payload.tool || payload.tool_name,
                display: payload.display || payload.tool_display || payload.tool,
                desc: payload.desc || "",
                path: payload.path,
                args: payload.args,
                status: "running",
                timestamp: Date.now()
              };
              setSessionActionsMap((prev) => ({
                ...prev,
                [targetKey]: [...(prev[targetKey] || []), newAction]
              }));

              const toolStep: TrajectoryStep = {
                id: newAction.id,
                type: "tool",
                tool: newAction.tool,
                display: newAction.display,
                desc: newAction.desc,
                path: newAction.path,
                args: payload.args,
                status: "running",
                timestamp: Date.now()
              };
              if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                autoScrollIfAtBottom();
              }
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const updated = [...list];
                const curTurn = updated[lastIdx];
                const curSteps = curTurn.steps || [];
                updated[lastIdx] = {
                  ...curTurn,
                  actions: [...(curTurn.actions || []), newAction],
                  steps: [...curSteps, toolStep]
                };
                return { ...prev, [targetKey]: updated };
              });
            } else if (payload.event === "tool_end" || payload.event === "tool_call_finished") {
              const tcId = payload.id || payload.tool_call_id;
              setSessionActionsMap((prev) => ({
                ...prev,
                [targetKey]: (prev[targetKey] || []).map((act) =>
                  act.id === tcId
                    ? {
                        ...act,
                        status: payload.status === "error" ? "error" : "success",
                        output: payload.output,
                        elapsed: payload.elapsed
                      }
                    : act
                )
              }));
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const updated = [...list];
                const curTurn = updated[lastIdx];
                const updatedSteps = (curTurn.steps || []).map((st) =>
                  st.id === tcId
                    ? {
                        ...st,
                        status: (payload.status === "error" ? "error" : "success") as any,
                        output: payload.output,
                        elapsed: payload.elapsed
                      }
                    : st
                );
                const updatedActions = (curTurn.actions || []).map((act) =>
                  act.id === tcId
                    ? {
                        ...act,
                        status: (payload.status === "error" ? "error" : "success") as any,
                        output: payload.output,
                        elapsed: payload.elapsed
                      }
                    : act
                );
                updated[lastIdx] = {
                  ...curTurn,
                  actions: updatedActions,
                  steps: updatedSteps
                };
                return { ...prev, [targetKey]: updated };
              });
              if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                autoScrollIfAtBottom();
              }
            } else if (payload.event === "stream_chunk") {
              const delta = payload.delta || "";
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const curTurn = list[lastIdx];

                // 若当前轮次已被用户手动暂停，绝对禁止追加任何后台在途文本碎片 (彻底解决图二串台 Bug)
                if (curTurn.is_paused || curTurn.assistant_response?.includes("【用户已手动暂停】")) {
                  return prev;
                }

                setSessionThoughtMap((prev) => ({
                  ...prev,
                  [targetKey]: (prev[targetKey] || "") + delta
                }));

                const updated = [...list];
                const curResponse = curTurn.assistant_response || "";
                const cleanThought = (curTurn.thought === "正在深度思考与执行下一步排查...")
                  ? ""
                  : curTurn.thought;
                updated[lastIdx] = {
                  ...curTurn,
                  thought: cleanThought,
                  assistant_response: curResponse + delta
                };
                return { ...prev, [targetKey]: updated };
              });

              if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                autoScrollIfAtBottom();
              }
            } else if (payload.event === "assistant_response") {
              // 精准释放目标会话的运行态
              setRunningSessions((prev) => ({ ...prev, [targetKey]: false }));

              if (payload.content && payload.content.includes("【会话已清空】")) {
                setSessionTurnsMap((prev) => ({ ...prev, [targetKey]: [] }));
                setSessionActionsMap((prev) => ({ ...prev, [targetKey]: [] }));
                setSessionThoughtMap((prev) => ({ ...prev, [targetKey]: "" }));
                if (targetKey === getSessionKey(projectNameRef.current, activeSessionIdRef.current)) {
                  setHasStarted(false);
                }
                return;
              }

              const isErrorResp = Boolean(payload.is_error || payload.content?.startsWith("❌") || payload.content?.startsWith("⚠️"));
              setSessionThoughtMap((prev) => ({
                ...prev,
                [targetKey]: isErrorResp ? "" : (payload.thought || payload.content)
              }));
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const curTurn = list[lastIdx];

                // 若当前轮次已被用户暂停且来的是非暂停确认内容，坚决不覆盖已暂停状态
                if (curTurn.is_paused || curTurn.assistant_response?.includes("【用户已手动暂停】")) {
                  if (!payload.content?.includes("【用户已手动暂停】")) {
                    return prev;
                  }
                }

                const turnElapsed = payload.elapsed !== undefined 
                  ? payload.elapsed 
                  : (curTurn.timestamp ? Math.max(1, Math.round(Date.now() / 1000 - curTurn.timestamp)) : curTurn.elapsed);

                const updated = [...list];
                const existingThought = (curTurn.thought === "正在深度思考与执行下一步排查..." || isErrorResp)
                  ? ""
                  : curTurn.thought;
                const effectiveThought = payload.thought || existingThought || "";

                // 同步保障 steps：若有思考内容但 steps 中尚未记录思考步骤，立即补充思考步骤，确保思考链常驻不消失
                let updatedSteps = curTurn.steps || [];
                if (effectiveThought && updatedSteps.filter(s => s.type === "assistant" || s.thought).length === 0) {
                  updatedSteps = [
                    {
                      id: `th_${Date.now()}`,
                      type: "assistant",
                      thought: effectiveThought,
                      timestamp: curTurn.timestamp || Date.now() / 1000
                    },
                    ...updatedSteps
                  ];
                }

                const asstCompletedTime = payload.timestamp || (Date.now() / 1000);
                updated[lastIdx] = {
                  ...curTurn,
                  thought: effectiveThought,
                  assistant_response: payload.content,
                  elapsed: turnElapsed,
                  steps: updatedSteps,
                  permission_mode: payload.permission_mode || curTurn.permission_mode,
                  start_timestamp: curTurn.start_timestamp || curTurn.timestamp,
                  completed_timestamp: asstCompletedTime,
                  timestamp: asstCompletedTime
                };
                return { ...prev, [targetKey]: updated };
              });

              // 仅静默同步刷新侧边栏工作区会话元数据（如最新轮次与时间），绝不重新拉取磁盘覆盖内存中在途消息
              fetchWorkspaces(projectNameRef.current, activeSessionIdRef.current, false);
            } else if (payload.event === "error") {
              setRunningSessions((prev) => ({ ...prev, [targetKey]: false }));
              const errorMsg = `❌ 模型调用异常: ${payload.message || "请求失败"}\n\n💡 检查建议: 请前往右下角「+ 添加模型」或「系统设置 -> 模型」检查当前模型配置、API 密钥与网络连接是否有效。`;
              setSessionTurnsMap((prev) => {
                const list = prev[targetKey] || [];
                if (list.length === 0) return prev;
                const lastIdx = list.length - 1;
                const curTurn = list[lastIdx];
                const turnElapsed = curTurn.timestamp 
                  ? Math.max(1, Math.round(Date.now() / 1000 - curTurn.timestamp)) 
                  : curTurn.elapsed;
                const updated = [...list];
                const asstCompletedTime = Date.now() / 1000;
                if (!updated[lastIdx].assistant_response) {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    assistant_response: errorMsg,
                    elapsed: turnElapsed,
                    completed_timestamp: asstCompletedTime,
                    timestamp: asstCompletedTime
                  };
                }
                return { ...prev, [targetKey]: updated };
              });
            }
          } catch (e) {}
        };

        ws.onopen = () => {
          setIsWsConnected(true);
        };

        ws.onclose = () => {
          setIsWsConnected(false);
          if (!isUnmounted) {
            setTimeout(connect, 2000);
          }
        };

        wsRef.current = ws;
      } catch (e) {}
    };

    connect();

    return () => {
      isUnmounted = true;
      ws?.close();
    };
  }, []);

  const saveCurrentSessionScroll = () => {
    if (chatContainerRef.current && isCurrentChatStarted) {
      const currentKey = getSessionKey(projectNameRef.current, activeSessionIdRef.current);
      sessionScrollMap.current[currentKey] = chatContainerRef.current.scrollTop;
    }
  };

  // 极致平滑且无闪烁的对话视口定位系统：默认直接展示最新一轮对话（底部）
  const scrollToLatestTurn = (immediate = true) => {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    const apply = () => {
      const el = chatContainerRef.current;
      if (!el) return;
      if (immediate) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
      isAtBottomRef.current = true;
      setShowScrollBottom(false);
    };
    apply();
    // 双重确保在 DOM 彻底计算完图片、代码块高度后仍稳定在最新一轮
    scrollRafRef.current = requestAnimationFrame(apply);
  };

  const handleScrollToBottom = () => {
    setShowScrollBottom(false);
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" });
      const currentKey = getSessionKey(projectNameRef.current, activeSessionIdRef.current);
      sessionScrollMap.current[currentKey] = chatContainerRef.current.scrollHeight;
    }
  };

  // 视口滚动监听：仅在聊天执行态且非恢复期记录，过滤 DOM 折叠产生的伪 0 像素干扰
  const handleViewportScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isRestoringScrollRef.current || !isCurrentChatStarted) return;
    const el = e.currentTarget;
    const top = el.scrollTop;
    if (el.scrollHeight <= el.clientHeight && top === 0) return;

    const currentKey = getSessionKey(projectNameRef.current, activeSessionIdRef.current);
    sessionScrollMap.current[currentKey] = top;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 40;
    isAtBottomRef.current = atBottom;
    setShowScrollBottom(!atBottom);

    // 动态计算视口当前聚焦的主导轮次 (Turn Ruler 实时高亮跟踪)
    if (scrollSpyRafRef.current === null && turns.length > 0) {
      scrollSpyRafRef.current = requestAnimationFrame(() => {
        scrollSpyRafRef.current = null;
        if (!chatContainerRef.current) return;
        const container = chatContainerRef.current;
        const cRect = container.getBoundingClientRect();
        const targetY = cRect.top + Math.min(220, cRect.height * 0.35);

        if (container.scrollHeight - container.scrollTop - container.clientHeight <= 50) {
          setActiveTurnId(turns[turns.length - 1].turn_id);
          return;
        }
        if (container.scrollTop <= 20) {
          setActiveTurnId(turns[0].turn_id);
          return;
        }

        let foundId = null;
        for (const t of turns) {
          const tEl = document.getElementById(`turn-container-${t.turn_id}`);
          if (tEl) {
            const rect = tEl.getBoundingClientRect();
            if (rect.top <= targetY && rect.bottom >= targetY) {
              foundId = t.turn_id;
              break;
            }
            if (rect.top > targetY && foundId === null) {
              foundId = t.turn_id;
              break;
            }
          }
        }
        if (foundId !== null) {
          setActiveTurnId(foundId);
        }
      });
    }
  };

  // 切换会话或轮次加载完成时：
  // 若用户在此运行周期内已经滚动过该会话，切回时精确恢复 scrollTop 位置；
  // 仅在首次打开该会话或发送新消息时，默认展示最新一轮对话（底部）
  useLayoutEffect(() => {
    if (!isCurrentChatStarted || turns.length === 0) return;
    const currentKey = getSessionKey(projectName, activeSessionId);
    if (lastScrolledSessionRef.current !== currentKey) {
      lastScrolledSessionRef.current = currentKey;
      const savedTop = sessionScrollMap.current[currentKey];
      if (savedTop !== undefined) {
        if (scrollRafRef.current) {
          cancelAnimationFrame(scrollRafRef.current);
        }
        const applySavedScroll = () => {
          const el = chatContainerRef.current;
          if (!el) return;
          isRestoringScrollRef.current = true;
          el.scrollTop = savedTop;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          const atBottom = dist <= 40;
          isAtBottomRef.current = atBottom;
          setShowScrollBottom(!atBottom);
          setTimeout(() => {
            isRestoringScrollRef.current = false;
          }, 80);
        };
        applySavedScroll();
        scrollRafRef.current = requestAnimationFrame(applySavedScroll);
      } else {
        scrollToLatestTurn(true);
      }
    }
  }, [activeSessionId, projectName, isCurrentChatStarted, turns.length]);

  // 在新增会话功能页面切换工作区：绝不跳转到旧对话，保持新建会话态，更新目标工作区
  const handleSelectProjectInEmptyState = (pname: string) => {
    setProjectName(pname);
    const newSid = `session_${Date.now()}`;
    setActiveSessionId(newSid);
    setHasStarted(false);

    const newKey = getSessionKey(pname, newSid);
    setSessionTurnsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionActionsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionThoughtMap((prev) => ({ ...prev, [newKey]: "" }));
    setSessionTitle("新会话");

    fetch("http://127.0.0.1:8765/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pname })
    })
      .then(() => {
        // 仅刷新侧边栏工作区项目结构，shouldLoadSession 设为 false，确保绝不跳转到历史对话
        fetchWorkspaces(pname, newSid, false);
      })
      .catch(() => {});
  };

  // 发送 Prompt 消息 (多会话并发状态完全隔离，支持附件上传与感知)
  const handleSendPrompt = (
    text: string, 
    model: string, 
    permission: string, 
    attachments: AttachmentItem[] = []
  ) => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    // 撤销指令：复用底部「撤销」按钮的完整回滚逻辑（含 UI 清理与磁盘归档）
    if (trimmed.toLowerCase() === "/undo") {
      const undoKey = getSessionKey(projectName, activeSessionId);
      const undoList = sessionTurnsMap[undoKey] || [];
      handleRollbackTurn(undoList.length > 0 ? undoList[undoList.length - 1].turn_id : 0);
      return;
    }

    if (!projectName) {
      if (projects.length > 0) {
        setProjectName(projects[0].name);
      } else {
        setIsCreateProjectOpen(true);
        return;
      }
    }

    const targetKey = getSessionKey(projectName, activeSessionId);
    const isFirstTurn = !hasStarted || (sessionTurnsMap[targetKey] || []).length === 0;

    // 若输入快捷清空命令，重置当前会话内存
    if (trimmed.toLowerCase() === "/clear" || trimmed.toLowerCase() === "/reset") {
      setSessionTurnsMap((prev) => ({ ...prev, [targetKey]: [] }));
      setSessionActionsMap((prev) => ({ ...prev, [targetKey]: [] }));
      setSessionThoughtMap((prev) => ({ ...prev, [targetKey]: "" }));
      setHasStarted(false);
    } else {
      setHasStarted(true);

      const titleCandidate = trimmed 
        ? text.slice(0, 24) 
        : (attachments[0] ? `附件: ${attachments[0].name}` : "新会话");

      // 若是在新建会话页面首次发送消息，立刻在该工作区侧边栏中渲染出该新建聊天框
      if (isFirstTurn) {
        if (projectName === "_general") {
          setRecentSessions((prev) => {
            const exists = prev.some((s) => s.session_id === activeSessionId);
            if (exists) return prev;
            const newSessionItem: SessionInfo = {
              session_id: activeSessionId,
              is_active: true,
              turn_count: 1,
              current_goal: titleCandidate,
              time_ago: "刚刚",
              is_pinned: false
            };
            return [newSessionItem, ...prev];
          });
        } else {
          setProjects((prevProjs) =>
            prevProjs.map((p) => {
              if (p.name === projectName) {
                const exists = (p.sessions || []).some((s) => s.session_id === activeSessionId);
                if (!exists) {
                  const newSessionItem: SessionInfo = {
                    session_id: activeSessionId,
                    is_active: true,
                    turn_count: 1,
                    current_goal: titleCandidate,
                    time_ago: "刚刚",
                    is_pinned: false
                  };
                  return {
                    ...p,
                    session_count: (p.sessions || []).length + 1,
                    sessions: [newSessionItem, ...(p.sessions || [])]
                  };
                }
              }
              return p;
            })
          );
        }

        fetch("http://127.0.0.1:8765/api/sessions/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: projectName, session_id: activeSessionId })
        }).catch(() => {});
      }

      // 乐观添加新的一轮至专属隔离会话字典 (包含附件)
      const curList = sessionTurnsMap[targetKey] || [];
      const nowSec = Date.now() / 1000;
      const tempTurn: TurnData = {
        turn_id: curList.length + 1,
        user_prompt: text,
        attachments: attachments,
        thought: "正在深度思考与执行下一步排查...",
        assistant_response: "",
        actions: [],
        steps: [],
        start_timestamp: nowSec,
        timestamp: nowSec,
        completed_timestamp: undefined,
        permission_mode: normalizeModeId(permission)
      };
      delete sessionScrollMap.current[targetKey];
      setSessionTurnsMap((prev) => ({
        ...prev,
        [targetKey]: [...(prev[targetKey] || []), tempTurn]
      }));
      setSessionThoughtMap((prev) => ({ ...prev, [targetKey]: "正在深度思考与执行下一步排查..." }));

      // 发送消息后重置吸底锁定并模拟鼠标平滑下滑至最新消息处
      isAtBottomRef.current = true;
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: "smooth"
          });
        }
        scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }

    // 仅锁定当前复合键对应的会话
    setRunningSessions((prev) => ({ ...prev, [targetKey]: true }));
    const titleCandidate = trimmed 
      ? text.slice(0, 24) 
      : (attachments[0] ? `附件: ${attachments[0].name}` : "新会话");
    setSessionTitle(titleCandidate);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "prompt",
          prompt: text,
          attachments: attachments,
          model: model,
          permission_mode: normalizeModeId(permission),
          session_id: activeSessionId,
          project_name: projectName
        })
      );
    } else {
      setTimeout(() => {
        setRunningSessions((prev) => ({ ...prev, [targetKey]: false }));
        setSessionThoughtMap((prev) => ({
          ...prev,
          [targetKey]: "⚠️ 后端服务正在建立连接，请稍候 1~2 秒后重试发送..."
        }));
      }, 500);
    }
  };

  // 对标 Claude Code Plan 模式：一键批准并无缝开始落地执行
  const handleApprovePlan = (targetMode: "auto" | "edit_auto" = "auto") => {
    const modeLabel = targetMode === "edit_auto" ? "Edit automatically" : "Auto 模式";
    handlePermissionChange(modeLabel);

    const promptText = targetMode === "edit_auto"
      ? "已批准上述施工方案，已切换至 Edit automatically 模式，请开始代码修改与分步落地实施。"
      : "已批准上述施工方案，已切换至 Auto 模式，请立即按计划逐步实施并进行测试验证。";

    handleSendPrompt(promptText, currentModel, modeLabel, []);
  };

  const handleRefinePlan = () => {
    setDraftPrompt("针对上述实施方案，我希望补充/调整：");
  };

  // 暂停当前会话的思考与执行 (对标需求 2)
  const handlePause = () => {
    const targetKey = getSessionKey(projectNameRef.current, activeSessionIdRef.current);
    setRunningSessions((prev) => ({ ...prev, [targetKey]: false }));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "abort",
          session_id: activeSessionIdRef.current,
          project_name: projectNameRef.current
        })
      );
    }

    setSessionActionsMap((prev) => {
      const list = prev[targetKey] || [];
      return {
        ...prev,
        [targetKey]: list.map((act) =>
          act.status === "running" ? { ...act, status: "interrupted" as const } : act
        )
      };
    });

    setSessionTurnsMap((prev) => {
      const list = prev[targetKey] || [];
      if (list.length === 0) return prev;
      const lastIdx = list.length - 1;
      const updated = [...list];
      const cur = updated[lastIdx];
      const calculatedElapsed = cur.timestamp
        ? Math.max(1, Math.round(Date.now() / 1000 - cur.timestamp))
        : 1;

      const updatedSteps = (cur.steps || []).map((st) =>
        st.status === "running" ? { ...st, status: "interrupted" as const } : st
      );
      const updatedActions = (cur.actions || []).map((act) =>
        act.status === "running" ? { ...act, status: "interrupted" as const } : act
      );

      // 强制打上已暂停标记，记录准确的发送至暂停真实耗时，彻底防止后续文本拼接与悬挂动态 (对标需求 2)
      updated[lastIdx] = {
        ...cur,
        steps: updatedSteps,
        actions: updatedActions,
        assistant_response: "【用户已手动暂停】已终止当前思考与工具调用。",
        elapsed: calculatedElapsed,
        is_paused: true
      };
      return { ...prev, [targetKey]: updated };
    });
  };

  // 用户气泡就地编辑并重发此轮 (对标需求 2)
  const handleResendTurn = (turnId: number, newPrompt: string) => {
    const targetKey = getSessionKey(projectName, activeSessionId);
    if (runningSessions[targetKey]) {
      handlePause();
    }

    setSessionTurnsMap((prev) => {
      const list = prev[targetKey] || [];
      const turnIdx = list.findIndex((t) => t.turn_id === turnId);
      if (turnIdx === -1) return prev;
      const keptTurns = list.slice(0, turnIdx);
      return { ...prev, [targetKey]: keptTurns };
    });

    setTimeout(() => {
      handleSendPrompt(newPrompt, currentModel, modeName);
    }, 60);
  };

  // 撤销最后一轮对话及所有改动 (仅最后一轮可见并可用)
  const handleRollbackTurn = async (turnId: number) => {
    if (isCurrentSessionLoading) return;
    const confirmed = window.confirm("确定要撤销最后一轮对话的所有改动吗？\n撤销后将还原该轮对话所修改或创建的文件，并移除该轮对话记录。");
    if (!confirmed) return;

    const proj = projectName;
    const sid = activeSessionId;
    const key = getSessionKey(proj, sid);

    try {
      const res = await fetch("http://127.0.0.1:8765/api/sessions/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: proj, session_id: sid })
      });
      const data = await res.json();
      if (data.success) {
        if (data.remaining_turns_count === 0) {
          // 该会话已被完全撤销清空（0轮次），彻底清除本地状态并切换会话，后端已物理删除磁盘文件
          setSessionTurnsMap((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setSessionActionsMap((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setTasks([]);
          setHasStarted(false);

          // 立即从侧边栏 optimistic 移除该会话，消除幽灵项
          setRecentSessions((prev) => prev.filter((s) => s.session_id !== sid));
          setProjects((prev) =>
            prev.map((p) =>
              p.name === proj || p.name.toLowerCase() === proj.toLowerCase()
                ? { ...p, sessions: (p.sessions || []).filter((s) => s.session_id !== sid) }
                : p
            )
          );
          if (proj === projectNameRef.current || proj.toLowerCase() === projectNameRef.current.toLowerCase()) {
            setSessions((prev) => prev.filter((s) => s.session_id !== sid));
          }

          const currentProjSessions = projectName === "_general"
            ? recentSessions
            : (projects.find((p) => p.name === projectName)?.sessions || []);
          const remainingSessions = currentProjSessions.filter((s) => s.session_id !== sid);

          let nextSid: string;
          if (remainingSessions.length > 0) {
            nextSid = remainingSessions[0].session_id;
            activeSessionIdRef.current = nextSid;
            setActiveSessionId(nextSid);
            loadSessionTurns(nextSid, projectName);
          } else {
            nextSid = `session_${Date.now()}`;
            activeSessionIdRef.current = nextSid;
            setActiveSessionId(nextSid);
            setSessionTitle("新会话");
          }

          fetchWorkspaces(projectName, nextSid, false);
        } else {
          setSessionTurnsMap((prev) => {
            const list = prev[key] || [];
            return { ...prev, [key]: list.filter((t) => t.turn_id !== turnId) };
          });
          loadSessionTurns(sid, proj, true);
        }
        const restored = data.restored_files || [];
        if (restored.length > 0) {
          alert(`已成功撤销此轮对话！\n还原/删除的文件：\n${restored.join("\n")}`);
        }
      } else {
        alert(data.message || "撤销失败，当前没有可供撤销的轮次。");
      }
    } catch (err) {
      console.error("撤销轮次失败:", err);
      alert("撤销轮次失败，网络或后端异常。");
    }
  };

  // 切换工作区/项目 (侧边栏触发)
  const handleSelectProject = (pname: string) => {
    saveCurrentSessionScroll();
    projectNameRef.current = pname;
    setProjectName(pname);
    fetch("http://127.0.0.1:8765/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: pname })
    })
      .then(() => {
        // 若当前处于新建会话未开始态，切换侧边栏项目也保持新建会话态
        fetchWorkspaces(pname, undefined, hasStarted);
      })
      .catch(() => {});
  };

  // 选择会话 (保留并优先恢复内存中在途消息，并记住上一会话的滚动停留位置)
  const handleSelectSession = (sid: string, projName?: string) => {
    saveCurrentSessionScroll();
    lastScrolledSessionRef.current = null;
    isRestoringScrollRef.current = false;

    const targetProj = projName || projectName;
    activeSessionIdRef.current = sid;
    projectNameRef.current = targetProj;
    if (targetProj !== projectName) {
      setProjectName(targetProj);
    }
    setActiveSessionId(sid);

    // 同步更新当前项目的 sessions 状态，防止被上一工程残留数据干扰
    if (targetProj === "_general") {
      setSessions(recentSessions);
    } else {
      const pObj = projects.find((p) => p.name === targetProj || p.name.toLowerCase() === targetProj.toLowerCase());
      if (pObj && pObj.sessions) {
        setSessions(pObj.sessions);
      }
    }

    const targetKey = getSessionKey(targetProj, sid);
    const cachedTurns = sessionTurnsMap[targetKey];
    if (cachedTurns && cachedTurns.length > 0) {
      setHasStarted(true);
    } else {
      // 检查当前会话是否为既有历史会话 (避免在数据返回前闪烁新建会话/空态视图)
      const currentProjObj = projects.find((p) => p.name === targetProj);
      const sessionList = currentProjObj ? currentProjObj.sessions : sessions;
      const targetSessionMeta = sessionList?.find((s) => s.session_id === sid);
      if (targetSessionMeta && targetSessionMeta.turn_count > 0) {
        setHasStarted(true);
      } else {
        setHasStarted(false);
      }
    }

    loadSessionTurns(sid, targetProj);
  };

  // 新建自由独立会话 (归属于最近)
  const handleNewRecentSession = () => {
    saveCurrentSessionScroll();
    lastScrolledSessionRef.current = null;
    isRestoringScrollRef.current = true;

    const generatedSid = `session_${Date.now()}`;
    const newKey = getSessionKey("_general", generatedSid);

    // 立即就绪新建会话状态，无缝展示空态，彻底消除等待响应时的闪烁
    projectNameRef.current = "_general";
    setProjectName("_general");
    activeSessionIdRef.current = generatedSid;
    setActiveSessionId(generatedSid);
    setHasStarted(false);
    setSessionTurnsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionActionsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionThoughtMap((prev) => ({ ...prev, [newKey]: "" }));
    setSessionTitle("新会话");

  };

  // 自由会话移入项目工作区
  const handleMoveSessionToProject = async (sid: string, fromProj: string, toProj: string, newOrder?: string[]) => {
    const oldKey = getSessionKey(fromProj, sid);
    const newKey = getSessionKey(toProj, sid);
    setSessionTurnsMap((prev) => {
      if (!prev[oldKey]) return prev;
      const updated = { ...prev };
      updated[newKey] = updated[oldKey];
      delete updated[oldKey];
      return updated;
    });

    if (activeSessionIdRef.current === sid) {
      projectNameRef.current = toProj;
      setProjectName(toProj);
    }

    let movedSession: SessionInfo | undefined;
    if (fromProj === "_general" || fromProj === "") {
      setRecentSessions((prev) => {
        movedSession = prev.find((s) => s.session_id === sid);
        return prev.filter((s) => s.session_id !== sid);
      });
    } else {
      setProjects((prev) => prev.map((p) => {
        if (p.name !== fromProj) return p;
        movedSession = (p.sessions || []).find((s) => s.session_id === sid);
        return {
          ...p,
          session_count: Math.max(0, p.session_count - 1),
          sessions: (p.sessions || []).filter((s) => s.session_id !== sid)
        };
      }));
    }

    if (!movedSession) {
      movedSession = {
        session_id: sid,
        is_active: sid === activeSessionIdRef.current,
        turn_count: 0,
        current_goal: sid === "default" ? "默认会话" : sid
      };
    }

    if (toProj === "_general" || toProj === "") {
      setRecentSessions((prev) => {
        const list = [movedSession!, ...prev.filter((s) => s.session_id !== sid)];
        if (newOrder && newOrder.length > 0) {
          const map = new Map(list.map((s) => [s.session_id, s]));
          const reordered: SessionInfo[] = [];
          for (const id of newOrder) {
            const item = map.get(id);
            if (item) {
              reordered.push(item);
              map.delete(id);
            }
          }
          for (const rem of map.values()) reordered.push(rem);
          return reordered;
        }
        return list;
      });
    } else {
      setProjects((prev) => prev.map((p) => {
        if (p.name !== toProj) return p;
        const list = [movedSession!, ...(p.sessions || []).filter((s) => s.session_id !== sid)];
        let finalSessions = list;
        if (newOrder && newOrder.length > 0) {
          const map = new Map(list.map((s) => [s.session_id, s]));
          const reordered: SessionInfo[] = [];
          for (const id of newOrder) {
            const item = map.get(id);
            if (item) {
              reordered.push(item);
              map.delete(id);
            }
          }
          for (const rem of map.values()) reordered.push(rem);
          finalSessions = reordered;
        }
        return {
          ...p,
          session_count: finalSessions.length,
          sessions: finalSessions
        };
      }));
    }

    try {
      await fetch("http://127.0.0.1:8765/api/sessions/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, from_project: fromProj, to_project: toProj })
      });
      if (newOrder && newOrder.length > 0) {
        await fetch("http://127.0.0.1:8765/api/sessions/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: toProj, session_order: newOrder })
        });
      }
      fetchWorkspaces(toProj, sid, false);
    } catch (e) {
      console.error("Failed to move session:", e);
    }
  };

  // 工作区拖拽重排保存
  const handleReorderProjects = async (newOrder: string[]) => {
    setProjects((prev) => {
      const map = new Map(prev.map((p) => [p.name, p]));
      const reordered: ProjectInfo[] = [];
      for (const name of newOrder) {
        const item = map.get(name);
        if (item) {
          reordered.push(item);
          map.delete(name);
        }
      }
      for (const rem of map.values()) reordered.push(rem);
      return reordered;
    });

    try {
      await fetch("http://127.0.0.1:8765/api/workspaces/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_order: newOrder })
      });
    } catch (e) {
      console.error("Failed to reorder projects:", e);
    }
  };

  // 会话拖拽重排保存
  const handleReorderSessions = async (project: string, newOrder: string[]) => {
    if (project === "_general" || project === "") {
      setRecentSessions((prev) => {
        const map = new Map(prev.map((s) => [s.session_id, s]));
        const reordered: SessionInfo[] = [];
        for (const sid of newOrder) {
          const item = map.get(sid);
          if (item) {
            reordered.push(item);
            map.delete(sid);
          }
        }
        for (const rem of map.values()) reordered.push(rem);
        return reordered;
      });
    } else {
      setProjects((prev) => prev.map((p) => {
        if (p.name !== project) return p;
        const map = new Map((p.sessions || []).map((s) => [s.session_id, s]));
        const reordered: SessionInfo[] = [];
        for (const sid of newOrder) {
          const item = map.get(sid);
          if (item) {
            reordered.push(item);
            map.delete(sid);
          }
        }
        for (const rem of map.values()) reordered.push(rem);
        return { ...p, sessions: reordered };
      }));
    }

    try {
      await fetch("http://127.0.0.1:8765/api/sessions/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: project || "_general", session_order: newOrder })
      });
    } catch (e) {
      console.error("Failed to reorder sessions:", e);
    }
  };

  // 新建会话 (注册全新隔离复合键)
  const handleNewSession = () => {
    saveCurrentSessionScroll();
    lastScrolledSessionRef.current = null;
    isRestoringScrollRef.current = true;

    const targetP = (projectName && projectName !== "_general" && projects.some((p) => p.name === projectName)) ? projectName : "_general";
    const generatedSid = `session_${Date.now()}`;
    const newKey = getSessionKey(targetP, generatedSid);

    // 立即就绪新建会话状态，无缝展示空态，彻底消除等待响应时的闪烁
    projectNameRef.current = targetP;
    activeSessionIdRef.current = generatedSid;
    setActiveSessionId(generatedSid);
    setHasStarted(false);
    setSessionTurnsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionActionsMap((prev) => ({ ...prev, [newKey]: [] }));
    setSessionThoughtMap((prev) => ({ ...prev, [newKey]: "" }));
    setSessionTitle("新会话");

  };

  // 打开图三样式的“新建项目工作区”弹窗
  const handleAddWorkspace = () => {
    setIsCreateProjectOpen(true);
  };

  // 确认创建并注册项目工作区
  const handleConfirmCreateProject = async (name: string, path: string) => {
    const res = await fetch("http://127.0.0.1:8765/api/workspaces/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "创建工作区失败");
    }
    const data = await res.json();
    if (data.name) {
      fetchWorkspaces(data.name);
      handleSelectProjectInEmptyState(data.name);
    }
  };

  // 切换大模型
  const handleSelectModel = (m: string) => {
    setCurrentModel(m);
    fetch("http://127.0.0.1:8765/api/models/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m })
    }).catch(() => {});
  };

  // 自定义提供方与模型更新回调
  const handleProvidersUpdated = (_providers: any[], activeModels: string[]) => {
    if (activeModels && activeModels.length > 0) {
      setAvailableModels(activeModels);
      if (!activeModels.includes(currentModel)) {
        setCurrentModel(activeModels[0]);
      }
    }
    fetchModels();
  };

  // 1. 编辑工作区 (更改名称及磁盘目录)
  const handleEditProject = (oldName: string, newName: string, path?: string) => {
    fetch("http://127.0.0.1:8765/api/workspaces/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_name: oldName, new_name: newName, path })
    })
      .then((res) => res.json())
      .then(() => {
        fetchWorkspaces(newName);
      })
      .catch(() => {});
  };

  // 2. 置顶 / 取消置顶工作区
  const handlePinProject = (name: string, pinned: boolean) => {
    fetch("http://127.0.0.1:8765/api/workspaces/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pinned })
    })
      .then(() => {
        fetchWorkspaces(projectName);
      })
      .catch(() => {});
  };

  // 3. 删除工作区 (自定义圆角确认弹窗)
  const handleDeleteProject = (name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "删除工作区",
      message: `确定要删除工作区 “${name}” 的全部记录吗？删除后此项目的历史记录将从本地清除。`,
      onConfirm: () => {
        setConfirmDialog(null);
        fetch("http://127.0.0.1:8765/api/workspaces/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        })
          .then(() => {
            const remaining = projects.filter((p) => p.name !== name);
            const fallbackProj = remaining.length > 0 ? remaining[0].name : "";
            fetchWorkspaces(fallbackProj, undefined, remaining.length > 0);
          })
          .catch(() => {});
      }
    });
  };

  // 4. 重命名会话
  const handleRenameSession = (project: string, sid: string, newTitle: string) => {
    fetch("http://127.0.0.1:8765/api/sessions/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, session_id: sid, new_title: newTitle })
    })
      .then(() => {
        fetchWorkspaces(projectNameRef.current, activeSessionIdRef.current, false);
      })
      .catch(() => {});
  };

  // 5. 置顶 / 取消置顶会话
  const handlePinSession = (project: string, sid: string, pinned: boolean) => {
    fetch("http://127.0.0.1:8765/api/sessions/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, session_id: sid, pinned })
    })
      .then(() => {
        fetchWorkspaces(projectNameRef.current, activeSessionIdRef.current, false);
      })
      .catch(() => {});
  };

  // 6. 删除会话 (自定义圆角确认弹窗)
  const handleDeleteSession = (project: string, sid: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "删除会话",
      message: "确定要删除此会话记录？删除后将无法恢复该对话内容。",
      onConfirm: () => {
        setConfirmDialog(null);

        const currentActiveSid = activeSessionIdRef.current;
        const currentActiveProj = projectNameRef.current;
        const isDeletingActive = (sid === currentActiveSid);

        // 1. 立即乐观更新本地状态，立即从侧边栏列表中剔除，给用户即时反馈
        const delKey = getSessionKey(project, sid);
        setSessionTurnsMap((prev) => {
          if (!prev[delKey]) return prev;
          const next = { ...prev };
          delete next[delKey];
          return next;
        });
        setSessionActionsMap((prev) => {
          if (!prev[delKey]) return prev;
          const next = { ...prev };
          delete next[delKey];
          return next;
        });
        setSessionThoughtMap((prev) => {
          if (!prev[delKey]) return prev;
          const next = { ...prev };
          delete next[delKey];
          return next;
        });

        // 计算删除后该工作区剩余的有效会话
        let remainingSessions: SessionInfo[] = [];
        if (project === "_general") {
          remainingSessions = recentSessions.filter((s) => s.session_id !== sid);
        } else {
          const curP = projects.find((p) => p.name === project || p.name.toLowerCase() === project.toLowerCase());
          remainingSessions = (curP?.sessions || []).filter((s) => s.session_id !== sid);
        }

        setRecentSessions((prev) => prev.filter((s) => s.session_id !== sid));
        setProjects((prev) =>
          prev.map((p) =>
            (p.name === project || p.name.toLowerCase() === project.toLowerCase())
              ? {
                  ...p,
                  sessions: (p.sessions || []).filter((s) => s.session_id !== sid),
                  session_count: Math.max(0, (p.sessions || []).filter((s) => s.session_id !== sid).length)
                }
              : p
          )
        );
        // 如果删除的是当前激活工程下的会话，更新当前 sessions
        if (project === currentActiveProj || project.toLowerCase() === currentActiveProj.toLowerCase()) {
          setSessions((prev) => prev.filter((s) => s.session_id !== sid));
        }

        // 2. 如果删除的是当前激活会话，平滑切换到同项目的下一个已有会话，杜绝无故生成空 id 会话
        let nextSidToSelect: string | undefined = undefined;
        if (isDeletingActive) {
          if (remainingSessions.length > 0) {
            nextSidToSelect = remainingSessions[0].session_id;
            activeSessionIdRef.current = nextSidToSelect;
            setActiveSessionId(nextSidToSelect);
            setHasStarted(true);
            loadSessionTurns(nextSidToSelect, project);
          } else {
            const freshSid = `session_${Date.now()}`;
            activeSessionIdRef.current = freshSid;
            setActiveSessionId(freshSid);
            setHasStarted(false);
            setSessionTitle("新会话");
          }
        }

        // 3. 调用后端接口物理删除 (Query 参数与 Request Body 双通道保障，支持 DELETE 与 POST)
        fetch(`http://127.0.0.1:8765/api/sessions/delete?session_id=${encodeURIComponent(sid)}&project=${encodeURIComponent(project)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, session_id: sid })
        })
          .then((res) => {
            if (!res.ok) console.warn("删除会话响应异常:", res.status);
            // 无论删除是否成功，保持当前应该激活的项目和会话，绝对不要重载或跳转到其它对话框！
            const targetProjToKeep = isDeletingActive ? project : currentActiveProj;
            const targetSidToKeep = isDeletingActive ? nextSidToSelect : currentActiveSid;
            fetchWorkspaces(targetProjToKeep, targetSidToKeep, false);
          })
          .catch((err) => {
            console.error("删除会话失败:", err);
          });
      }
    });
  };

  const isAnyModalOpen =
    showSettings ||
    showPlugins ||
    isCreateProjectOpen ||
    Boolean(confirmDialog?.isOpen) ||
    Boolean(selectedFile);

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans select-text pt-8 transition-colors duration-150 relative ${
      theme === "dark" ? "bg-[#0f1117] text-gray-100 dark" : "bg-white text-gray-900"
    }`}>
      {/* 顶层 32px 全局窗口拖拽与控制栏 (对标需求 1、2、4) */}
      <div className={`fixed top-0 left-0 right-0 h-8 flex items-center justify-between z-50 select-none bg-white/95 dark:bg-[#11131a]/95 backdrop-blur-xs border-b border-gray-100 dark:border-[#1d202b] ${isAnyModalOpen ? "titlebar-no-drag pointer-events-none" : "titlebar-drag-region"}`}>
        <div className="flex items-center pl-3 gap-2 text-[11px] text-gray-400 dark:text-gray-500 font-medium">
          {/* 窗口拖拽留白区 */}
        </div>
        <WindowControls />
      </div>
      {/* 1. 左侧工作区导航栏 (展示 4 个项目的全部聊天历史，透明图形 Logo) */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        projectName={projectName}
        projects={projects}
        sessions={sessions}
        recentSessions={recentSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onSelectProject={handleSelectProject}
        onNewSession={handleNewSession}
        onNewRecentSession={handleNewRecentSession}
        onAddWorkspace={handleAddWorkspace}
        onOpenSettings={() => setShowSettings(true)}
        onOpenPlugins={() => setShowPlugins(true)}
        onEditProject={handleEditProject}
        onPinProject={handlePinProject}
        onDeleteProject={handleDeleteProject}
        onRenameSession={handleRenameSession}
        onPinSession={handlePinSession}
        onDeleteSession={handleDeleteSession}
        onMoveSessionToProject={handleMoveSessionToProject}
        onReorderProjects={handleReorderProjects}
        onReorderSessions={handleReorderSessions}
      />

      {/* 2. 主工作区视口 (包含主操作区与当前会话专属调试侧边栏，支持最大化完全覆盖) */}
      <div className="flex-1 h-full flex flex-row overflow-hidden relative">
        {/* 2.1 主操作区 (设置 min-w-[380px] 保障窗口还原/缩小时对话区绝对不会被压缩消失) */}
        <div className="flex-1 h-full flex flex-col min-w-[380px] bg-white dark:bg-[#0f1117] overflow-hidden relative transition-colors">
        {!isWsConnected && (
          <div className="w-full bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400 select-none animate-pulse z-50">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <span>正在连接后端服务 (127.0.0.1:8765)... 若刚启动请稍候</span>
          </div>
        )}
        {/* 顶部标题栏 (展示当前工程与对话/轨迹切换，未开始时显示窗口操作按钮) */}
        {isCurrentChatStarted ? (
          <Header
            sessionTitle={sessionTitle}
            projectName={projectName}
            modeName={modeName}
            activeTab={activeTab}
            onTabChange={(tab) => setActiveTab(tab)}
            onExportLog={() => {}}
            isDevToolsOpen={isDevToolsOpen}
            onToggleDevTools={handleToggleDevTools}
          />
        ) : (
          <div className="h-12 flex items-center justify-end px-5 titlebar-drag-region select-none shrink-0 bg-transparent transition-colors">
            <button
              type="button"
              onClick={handleToggleDevTools}
              className={`p-1.5 rounded-lg border transition cursor-pointer titlebar-no-drag ${
                isDevToolsOpen
                  ? "bg-blue-50 dark:bg-[#1a2333] border-blue-200 dark:border-blue-800/60 text-blue-600 dark:text-blue-400"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[#1f2230] border-gray-200/80 dark:border-[#262a38]"
              }`}
              title="调试侧边栏 (内置终端 & 浏览器)"
            >
              <PanelRight size={15} />
            </button>
          </div>
        )}

        {/* 主视口内容区 (分流隔离：空态视图拥有独立容器，绝不污染或重置聊天视口的滚动高度) */}
        {!isCurrentChatStarted ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 flex flex-col">
            <EmptyState
              projectName={projectName}
              sessionId={activeSessionId}
              projects={projects}
              modeName={modeName}
              onSend={handleSendPrompt}
              isLoading={isCurrentSessionLoading}
              models={availableModels}
              selectedModel={currentModel}
              modelProviders={modelProviders}
              onSelectModel={handleSelectModel}
              onOpenModelSettings={() => setShowSettings(true)}
              onSelectProject={handleSelectProjectInEmptyState}
              onAddWorkspace={handleAddWorkspace}
              onPause={handlePause}
              onPermissionChange={handlePermissionChange}
            />
          </div>
        ) : (
          <div
            ref={chatContainerRef}
            onScroll={handleViewportScroll}
            style={{ overflowAnchor: "none" }}
            className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 flex flex-col"
          >
            {/* 会话执行态：支持“对话”与“轨迹”双模自由切换，流式逐字输出 (宽度为原 64rem 的 90%，与底部输入框严格同步) */}
            <div className="w-full max-w-[57.6rem] mx-auto min-w-0 flex-1 flex flex-col">

              {activeTab === "chat" ? (
                /* 对话流视图：展示完整历史问答轮次、实时流式思考与折叠步骤 (对标图四) */
                <div className="space-y-2 flex-1 relative">
                  {turns.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 py-24 select-none">
                      <div className="flex items-center gap-2.5 text-xs">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                        <span>正在加载历史会话...</span>
                      </div>
                    </div>
                  ) : (
                    turns.map((turn, idx) => (
                      <ChatMessage
                        key={turn.turn_id}
                        turn={turn}
                        isLoading={isCurrentSessionLoading && idx === turns.length - 1}
                        isLatestTurn={idx === turns.length - 1}
                        approvalReq={isCurrentSessionLoading && idx === turns.length - 1 ? approvalReq : null}
                        onApproveApproval={(tid, trust) => handleResolveApproval(tid, true, trust)}
                        onRejectApproval={(tid) => handleResolveApproval(tid, false, false)}
                        userInputReq={isCurrentSessionLoading && idx === turns.length - 1 ? userInputReq : null}
                        onSubmitUserInput={handleResolveUserInput}
                        onCancelUserInput={handleCancelUserInput}
                        onOpenFile={(p) => setSelectedFile(p)}
                        onEditPrompt={(txt) => setDraftPrompt(txt)}
                        onResendTurn={handleResendTurn}
                        onOpenSettings={() => setShowSettings(true)}
                        onRollbackTurn={handleRollbackTurn}
                      />
                    ))
                  )}
                  {isCurrentSessionLoading && turns.length === 0 && (
                    <div className="flex items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-2xl text-xs text-blue-700 animate-pulse">
                      <img src={LOGO_DATA_URI} alt="super logo" className="w-5 h-5 object-contain shrink-0" />
                      <span>super 智能体正在流式思考与组织回复...</span>
                    </div>
                  )}
                </div>
              ) : (
                /* 轨迹流视图：100% 对标图一标准，连贯时间线，醒目 TOOL / ASSISTANT 徽标与请求出参卡片 */
                <div className="flex-1 flex flex-col space-y-4">
                  <TrajectoryTimeline
                    turns={turns}
                    rawActions={actions}
                    thoughtText={thoughtText}
                    onOpenFile={(p) => setSelectedFile(p)}
                  />
                  <TaskDrawer tasks={tasks} />
                </div>
              )}

              <div ref={scrollEndRef} className="h-8" />
            </div>
          </div>
        )}

        {/* 对话轮次记录导航尺 (贴近左侧边栏，垂直居中固定，绝对不随页面滚动，完全避免与 super 头像重叠) */}
        {isCurrentChatStarted && activeTab === "chat" && turns.length > 0 && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 z-30 pointer-events-auto">
            <TurnRuler turns={turns} activeTurnId={activeTurnId} onScrollToTurn={handleScrollToTurn} />
          </div>
        )}

        {/* 底部吸附输入栏 (带 '+' 快捷指令菜单、📎 附件上传、AUTO 模式、点击空白关闭下拉) */}
        {isCurrentChatStarted && (
          <BottomInput
            onSend={handleSendPrompt}
            isLoading={isCurrentSessionLoading}
            onScrollToBottom={handleScrollToBottom}
            showScrollBottom={showScrollBottom}
            models={availableModels}
            selectedModel={currentModel}
            modelProviders={modelProviders}
            onSelectModel={handleSelectModel}
            onOpenModelSettings={() => setShowSettings(true)}
            draftText={draftPrompt}
            onDraftConsumed={() => setDraftPrompt("")}
            onPause={handlePause}
            projectName={projectName}
            sessionId={activeSessionId}
            permissionMode={modeName}
            onPermissionChange={handlePermissionChange}
          />
        )}
      </div>

      {/* 2.2 右侧调试侧边栏 (归属于当前对话框，支持最大化完全覆盖，对标需求 4 & 5) */}
      <DevToolsSidebar
        isOpen={isDevToolsOpen}
        onClose={handleToggleDevTools}
        workspacePath={projects.find((p) => p.name === projectName)?.path || ""}
        sessionKey={currentSessionKey}
        tabs={currentDevToolsTabs}
        onTabsChange={(tabs) => setSessionDevToolsTabsMap((prev) => ({ ...prev, [currentSessionKey]: tabs }))}
        activeTabId={currentDevToolsActiveTabId}
        onActiveTabChange={(id) => setSessionDevToolsActiveTabMap((prev) => ({ ...prev, [currentSessionKey]: id }))}
        terminalOutputs={currentTerminalOutputs}
        onTerminalOutputsChange={(outputs) => setSessionTerminalOutputsMap((prev) => ({ ...prev, [currentSessionKey]: outputs }))}
        isMaximized={isDevToolsMaximized}
        onToggleMaximize={(max) => setSessionDevToolsMaximizedMap((prev) => ({ ...prev, [currentSessionKey]: max }))}
      />
    </div>

      

      {/* 3. 模态框与抽屉组件 */}
      <CreateProjectModal
        isOpen={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
        onCreate={handleConfirmCreateProject}
      />
      <FileViewerModal filePath={selectedFile} onClose={() => setSelectedFile(null)} />
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentModel={currentModel}
        onSaveModel={handleSelectModel}
        onProvidersUpdated={handleProvidersUpdated}
        theme={theme}
        onSelectTheme={(t) => setTheme(t)}
        fontSizeLevel={fontSizeLevel}
        onSelectFontSize={(lvl) => setFontSizeLevel(lvl)}
      />
      <PluginsModal isOpen={showPlugins} onClose={() => setShowPlugins(false)} />
      {/* 敏感操作审批与用户决策卡片已无缝集成至思考与工具执行流内部，消除居中遮罩弹窗 (对标图二) */}
      <ConfirmModal
        isOpen={Boolean(confirmDialog?.isOpen)}
        title={confirmDialog?.title || "操作确认"}
        message={confirmDialog?.message || ""}
        confirmText="确定删除"
        danger={true}
        onConfirm={() => {
          if (confirmDialog?.onConfirm) confirmDialog.onConfirm();
        }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
};
