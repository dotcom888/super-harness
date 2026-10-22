import { ModalTransition } from "./ModalTransition";
import { DropdownTransition } from "./DropdownTransition";
import React, { useState, useEffect, useRef } from "react";
import { 
  Folder, 
  Plus, 
  FolderPlus, 
  Puzzle, 
  Settings, 
  PanelLeftClose, 
  PanelLeft, 
  ChevronDown,
  ChevronUp, 
  ChevronRight,
  MoreHorizontal,
  Pin,
  PinOff,
  Edit2,
  Trash2,
  X,
  FolderOpen,
  Edit3,
  MessageSquare
} from "lucide-react";
import { SessionInfo, ProjectInfo } from "../types";
import { LOGO_DATA_URI } from "../assets/logoData";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  projectName: string;
  projects?: ProjectInfo[];
  sessions: SessionInfo[];
  recentSessions?: SessionInfo[];
  activeSessionId: string;
  onSelectSession: (id: string, projectName?: string) => void;
  onSelectProject?: (name: string) => void;
  onNewSession: () => void;
  onNewRecentSession?: () => void;
  onAddWorkspace?: () => void;
  onOpenSettings: () => void;
  onOpenPlugins: () => void;
  onEditProject?: (oldName: string, newName: string, path?: string) => void;
  onPinProject?: (name: string, pinned: boolean) => void;
  onDeleteProject?: (name: string) => void;
  onRenameSession?: (project: string, sid: string, newTitle: string) => void;
  onPinSession?: (project: string, sid: string, pinned: boolean) => void;
  onDeleteSession?: (project: string, sid: string) => void;
  onMoveSessionToProject?: (sid: string, fromProj: string, toProj: string, targetOrder?: string[]) => void;
  onReorderProjects?: (newOrder: string[]) => void;
  onReorderSessions?: (project: string, newOrder: string[]) => void;
}

// 拖拽源与放置目标状态类型
interface DragSource {
  type: "project" | "session";
  id: string; // project name 或 session_id
  project?: string; // 所属项目 (或 "_general")
  title: string;
}

interface DropTargetState {
  type: "project" | "session" | "folder";
  targetProject?: string; // 目标项目名或 "_general"
  targetSid?: string; // 目标会话ID
  position?: "before" | "after"; // 蓝线指示放置位置 (对标图二)
}

// 放置位置指示线组件 (对标图二：蓝色实线并在左边缘带有右向箭头尖角)
const DropIndicator: React.FC<{ position: "top" | "bottom" }> = ({ position }) => (
  <div 
    className={`absolute left-0 right-0 ${
      position === "top" ? "-top-[1px]" : "-bottom-[1px]"
    } z-40 pointer-events-none flex items-center`}
  >
    <svg 
      className="w-2.5 h-3.5 -ml-1 text-blue-600 dark:text-blue-500 shrink-0" 
      viewBox="0 0 10 14" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="1,2 8,7 1,12" />
    </svg>
    <div className="flex-1 h-[2px] bg-blue-600 dark:bg-blue-500 shadow-xs" />
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  projectName,
  projects = [],
  sessions,
  recentSessions = [],
  activeSessionId,
  onSelectSession,
  onSelectProject,
  onNewSession,
  onNewRecentSession,
  onAddWorkspace,
  onOpenSettings,
  onOpenPlugins,
  onEditProject,
  onPinProject,
  onDeleteProject,
  onRenameSession,
  onPinSession,
  onDeleteSession,
  onMoveSessionToProject,
  onReorderProjects,
  onReorderSessions
}) => {
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("super_projects_expanded");
      if (saved !== null) return JSON.parse(saved);
    } catch (e) {}
    return true;
  });

  const [isRecentExpanded, setIsRecentExpanded] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("super_recent_expanded");
      if (saved !== null) return JSON.parse(saved);
    } catch (e) {}
    return true;
  });

  // 工作区展开/收起状态持久化 (解决需求 1：切换会话时不再自动收起任何工作区)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("super_expanded_projects");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [expandedMoreProjects, setExpandedMoreProjects] = useState<Record<string, boolean>>({});

  // 操作菜单弹出层状态与退场快照
  const [activeProjectMenu, setActiveProjectMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [activeSessionMenu, setActiveSessionMenu] = useState<{ project: string; sid: string; x: number; y: number } | null>(null);
  const [projectMenuSnapshot, setProjectMenuSnapshot] = useState<{ name: string; x: number; y: number } | null>(null);
  const [sessionMenuSnapshot, setSessionMenuSnapshot] = useState<{ project: string; sid: string; x: number; y: number } | null>(null);

  // 编辑项目工作区弹窗与退场快照
  const [editingProject, setEditingProject] = useState<{ oldName: string; newName: string; path: string } | null>(null);
  const [editingProjectSnapshot, setEditingProjectSnapshot] = useState<{ oldName: string; newName: string; path: string } | null>(null);

  // 重命名会话弹窗与退场快照
  const [renamingSession, setRenamingSession] = useState<{ project: string; sid: string; title: string } | null>(null);
  const [renamingSessionSnapshot, setRenamingSessionSnapshot] = useState<{ project: string; sid: string; title: string } | null>(null);

  const openProjectMenu = (menu: { name: string; x: number; y: number }) => {
    setActiveProjectMenu(menu);
    setProjectMenuSnapshot(menu);
  };
  const openSessionMenu = (menu: { project: string; sid: string; x: number; y: number }) => {
    setActiveSessionMenu(menu);
    setSessionMenuSnapshot(menu);
  };
  const openEditProject = (val: { oldName: string; newName: string; path: string }) => {
    setEditingProject(val);
    setEditingProjectSnapshot(val);
  };
  const openRenameSession = (val: { project: string; sid: string; title: string }) => {
    setRenamingSession(val);
    setRenamingSessionSnapshot(val);
  };

  // 鼠标拖拽排序与移动相关状态 (对标需求 2 & 图二)
  const [isDragging, setIsDragging] = useState(false);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const dragPendingRef = useRef<{
    source: DragSource;
    startX: number;
    startY: number;
    startTime: number;
    timerId: any;
  } | null>(null);

  const isDraggingRef = useRef(false);
  const justDroppedRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // 当当前选中的会话切换时，若其归属于某个工作区，确保该工作区已展开，但绝不影响或收起其它已展开工作区
  useEffect(() => {
    if (projectName && projectName !== "_general") {
      setExpandedProjects((prev) => {
        if (prev[projectName] === true) return prev;
        const next = { ...prev, [projectName]: true };
        try {
          localStorage.setItem("super_expanded_projects", JSON.stringify(next));
        } catch (e) {}
        return next;
      });
    }
  }, [projectName]);

  const toggleProject = (name: string) => {
    setExpandedProjects((prev) => {
      const currentVal = prev[name] ?? true;
      const nextVal = !currentVal;
      const next = { ...prev, [name]: nextVal };
      try {
        localStorage.setItem("super_expanded_projects", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const handleToggleProjectsHeader = () => {
    setIsProjectsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("super_projects_expanded", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const handleToggleRecentHeader = () => {
    setIsRecentExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("super_recent_expanded", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  // 选择磁盘目录
  const handleBrowseDir = async () => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.selectDirectory) {
      try {
        const dir = await electronAPI.selectDirectory();
        if (dir && editingProject) {
          setEditingProject({ ...editingProject, path: dir });
        }
      } catch (e) {}
    }
  };

  // 鼠标长按或按住移动启动拖拽 (对标需求 2：可以使用鼠标长按住对话框或者工作区改变位置)
  const handleItemMouseDown = (e: React.MouseEvent, source: DragSource) => {
    if (e.button !== 0) return; // 仅限左键
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest(".no-drag")) {
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;

    // 450ms 长按判定定时器 (仅在真正长按时触发拖拽，普通轻击与标准点击绝不阻塞会话选中)
    const timerId = setTimeout(() => {
      startDrag(source, startX, startY);
    }, 450);

    dragPendingRef.current = {
      source,
      startX,
      startY,
      startTime: Date.now(),
      timerId
    };
  };

  const startDrag = (source: DragSource, x: number, y: number) => {
    setIsDragging(true);
    isDraggingRef.current = true;
    setDragSource(source);
    setMousePos({ x, y });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
  };

  // 全局鼠标移动与释放监听 (处理拖拽指示线与位置计算)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 若鼠标按下并移动超过 8px，立即启动拖拽
      if (dragPendingRef.current && !isDraggingRef.current) {
        const dx = e.clientX - dragPendingRef.current.startX;
        const dy = e.clientY - dragPendingRef.current.startY;
        if (dx * dx + dy * dy >= 64) {
          clearTimeout(dragPendingRef.current.timerId);
          startDrag(dragPendingRef.current.source, e.clientX, e.clientY);
        }
      }

      if (!isDraggingRef.current || !dragPendingRef.current) return;

      setMousePos({ x: e.clientX, y: e.clientY });

      // 边缘自动滚动
      if (scrollContainerRef.current) {
        const rect = scrollContainerRef.current.getBoundingClientRect();
        if (e.clientY < rect.top + 35) {
          scrollContainerRef.current.scrollTop -= 6;
        } else if (e.clientY > rect.bottom - 35) {
          scrollContainerRef.current.scrollTop += 6;
        }
      }

      // 计算指针所在的目标元素
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el) {
        setDropTarget(null);
        return;
      }

      const currentSource = dragPendingRef.current.source;

      // 场景 1：拖拽工作区 (仅支持工作区之间相互调整次序)
      if (currentSource.type === "project") {
        const projTarget = el.closest("[data-drag-project]") as HTMLElement | null;
        if (projTarget) {
          const targetProjName = projTarget.getAttribute("data-drag-project");
          if (targetProjName && targetProjName !== currentSource.id) {
            const rect = projTarget.getBoundingClientRect();
            const isUpper = (e.clientY - rect.top) < (rect.height / 2);
            setDropTarget({
              type: "project",
              targetProject: targetProjName,
              position: isUpper ? "before" : "after"
            });
            return;
          }
        }
        setDropTarget(null);
        return;
      }

      // 场景 2：拖拽会话 (支持工作区内会话重排、跨工作区移动、移入未分组、或从未分组移入工作区)
      if (currentSource.type === "session") {
        // A. 悬停在某个具体会话上 (展示蓝线指示线)
        const sessTarget = el.closest("[data-drag-session]") as HTMLElement | null;
        if (sessTarget) {
          const targetSid = sessTarget.getAttribute("data-drag-session");
          const targetProj = sessTarget.getAttribute("data-drag-session-project") || "_general";
          if (targetSid && (targetSid !== currentSource.id || targetProj !== (currentSource.project || "_general"))) {
            const rect = sessTarget.getBoundingClientRect();
            const isUpper = (e.clientY - rect.top) < (rect.height / 2);
            setDropTarget({
              type: "session",
              targetProject: targetProj,
              targetSid,
              position: isUpper ? "before" : "after"
            });
            return;
          }
        }

        // B. 悬停在某个项目工作区头部文件夹上 (高亮文件夹，释放移入该项目顶部)
        const projHeader = el.closest("[data-drag-project-folder]") as HTMLElement | null;
        if (projHeader) {
          const targetProj = projHeader.getAttribute("data-drag-project-folder");
          if (targetProj) {
            setDropTarget({
              type: "folder",
              targetProject: targetProj
            });
            return;
          }
        }

        // C. 悬停在未分组文件夹头部上 (高亮未分组，释放移入未分组顶部)
        const recentHeader = el.closest("[data-drag-recent-folder]") as HTMLElement | null;
        if (recentHeader) {
          setDropTarget({
            type: "folder",
            targetProject: "_general"
          });
          return;
        }

        // D. 悬停在空工作区区域上
        const emptyTarget = el.closest("[data-drag-empty-project]") as HTMLElement | null;
        if (emptyTarget) {
          const targetProj = emptyTarget.getAttribute("data-drag-empty-project");
          if (targetProj) {
            setDropTarget({
              type: "folder",
              targetProject: targetProj
            });
            return;
          }
        }

        setDropTarget(null);
      }
    };

    const handleMouseUp = () => {
      if (dragPendingRef.current) {
        clearTimeout(dragPendingRef.current.timerId);
      }

      if (isDraggingRef.current && dragPendingRef.current) {
        const source = dragPendingRef.current.source;
        const target = dropTarget;

        if (target) {
          executeDrop(source, target);
          justDroppedRef.current = true;
          setTimeout(() => {
            justDroppedRef.current = false;
          }, 120);
        }
      }

      dragPendingRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      setDragSource(null);
      setDropTarget(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dropTarget, projects, recentSessions]);

  // 执行最终放置与位置更新
  const executeDrop = (source: DragSource, target: DropTargetState) => {
    // 1. 工作区重排
    if (source.type === "project") {
      if (target.type === "project" && target.targetProject) {
        const names = projects.map((p) => p.name);
        const fromIdx = names.indexOf(source.id);
        if (fromIdx !== -1) {
          names.splice(fromIdx, 1);
          let toIdx = names.indexOf(target.targetProject);
          if (target.position === "after") toIdx += 1;
          names.splice(toIdx, 0, source.id);
          onReorderProjects?.(names);
        }
      }
      return;
    }

    // 2. 会话重排或跨工作区/未分组移动
    if (source.type === "session") {
      const fromProj = source.project || "_general";
      const toProj = target.targetProject || "_general";

      if (target.type === "session" && target.targetSid) {
        if (fromProj === toProj) {
          // 同一项目或未分组内部重排
          const list = fromProj === "_general" ? recentSessions : (projects.find((p) => p.name === fromProj)?.sessions || []);
          const sids = list.map((s) => s.session_id);
          const fromIdx = sids.indexOf(source.id);
          if (fromIdx !== -1) {
            sids.splice(fromIdx, 1);
            let toIdx = sids.indexOf(target.targetSid);
            if (target.position === "after") toIdx += 1;
            sids.splice(toIdx, 0, source.id);
            onReorderSessions?.(fromProj, sids);
          }
        } else {
          // 跨工作区或在工作区与未分组之间移动到指定顺序
          const targetList = toProj === "_general" ? recentSessions : (projects.find((p) => p.name === toProj)?.sessions || []);
          const sids = targetList.map((s) => s.session_id).filter((id) => id !== source.id);
          let toIdx = sids.indexOf(target.targetSid);
          if (target.position === "after") toIdx += 1;
          sids.splice(toIdx, 0, source.id);

          // 自动展开目标工作区，确保移入后立即可见
          if (toProj !== "_general") {
            setExpandedProjects((prev) => ({ ...prev, [toProj]: true }));
          }
          onMoveSessionToProject?.(source.id, fromProj, toProj, sids);
        }
        return;
      }

      if (target.type === "folder") {
        if (fromProj === toProj) return;
        const targetList = toProj === "_general" ? recentSessions : (projects.find((p) => p.name === toProj)?.sessions || []);
        const sids = [source.id, ...targetList.map((s) => s.session_id).filter((id) => id !== source.id)];

        if (toProj !== "_general") {
          setExpandedProjects((prev) => ({ ...prev, [toProj]: true }));
        }
        onMoveSessionToProject?.(source.id, fromProj, toProj, sids);
      }
    }
  };

  if (collapsed) {
    return (
      <aside className="w-14 h-full bg-[#f8f9fa] border-r border-[#e5e7eb] flex flex-col items-center py-3 justify-between select-none">
        <div className="flex flex-col items-center gap-4">
          <button 
            onClick={onToggleCollapse} 
            className="p-2 hover:bg-[#e5e7eb] rounded-lg text-gray-600 transition cursor-pointer"
            title="展开侧边栏"
          >
            <PanelLeft size={20} />
          </button>
          <button 
            onClick={onNewSession} 
            className="p-2 bg-white border border-[#e5e7eb] shadow-sm hover:bg-gray-50 rounded-lg text-gray-700 transition cursor-pointer"
            title="新会话"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button onClick={onOpenPlugins} className="p-2 hover:bg-[#e5e7eb] rounded-lg text-gray-600 transition cursor-pointer" title="插件">
            <Puzzle size={18} />
          </button>
          <button onClick={onOpenSettings} className="p-2 hover:bg-[#e5e7eb] rounded-lg text-gray-600 transition cursor-pointer" title="设置">
            <Settings size={18} />
          </button>
        </div>
      </aside>
    );
  }

  const displayProjects = projects;

  return (
    <aside className="w-64 h-full bg-[#f8f9fa] dark:bg-[#13151b] border-r border-[#e5e7eb] dark:border-[#20222b] flex flex-col justify-between select-none shrink-0 relative transition-colors duration-150">
      {/* 顶部 Brand 与 折叠按钮 */}
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#f1f3f5] shrink-0">
          <div className="flex items-center gap-2.5">
            <img 
              src={LOGO_DATA_URI} 
              alt="super logo" 
              className="w-6 h-6 object-contain shrink-0" 
            />
            <span className="font-bold text-[16px] tracking-tight text-gray-900 dark:text-white">super</span>
            <span className="bg-black text-white text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider">HARNESS</span>
          </div>
          <button 
            onClick={onToggleCollapse} 
            className="text-gray-400 hover:text-gray-700 p-1 hover:bg-[#e5e7eb] rounded transition cursor-pointer"
            title="收起侧边栏"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* 新会话悬浮按钮 */}
        <div className="px-3 py-3 shrink-0">
          <button
            onClick={onNewSession}
            className="w-full flex items-center justify-center gap-2 py-2 bg-white dark:bg-[#1e202a] border border-[#e5e7eb] dark:border-[#2a2d39] hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-[#252835] shadow-sm rounded-xl text-gray-800 dark:text-gray-100 font-medium text-sm transition cursor-pointer"
          >
            <Plus size={16} className="text-gray-600" />
            <span>新会话</span>
          </button>
        </div>

        {/* 工作区多项目目录树（展示全部项目，带置顶与更多操作） */}
        <div ref={scrollContainerRef} className="px-3 pt-1 flex-1 overflow-y-auto">
          <div className="space-y-1">
            <div 
              onClick={handleToggleProjectsHeader}
              className="flex items-center justify-between px-1.5 py-1 text-xs text-gray-600 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-100/70 dark:hover:bg-[#1a1d27] transition cursor-pointer"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {isProjectsExpanded ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                <span className="font-bold">项目</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                  ({displayProjects.length})
                </span>
              </div>
              <div className="flex items-center gap-1 text-gray-400 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onAddWorkspace) onAddWorkspace();
                  }}
                  className="p-1 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-200/60 dark:hover:bg-[#222534] rounded transition cursor-pointer"
                  title="添加工作区 (选择磁盘项目)"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

          {isProjectsExpanded && (
            <div className="space-y-1 pb-2 pl-0.5">
            {displayProjects.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400 dark:text-gray-500 flex flex-col items-center gap-2">
                <FolderPlus size={20} className="text-gray-300 dark:text-gray-600 mb-0.5" />
                <span className="font-medium text-gray-500 dark:text-gray-400">暂无项目工作区</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">点击右上角或下方添加</span>
                <button
                  type="button"
                  onClick={onAddWorkspace}
                  className="mt-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  + 添加工作区
                </button>
              </div>
            ) : (
              displayProjects.map((proj) => {
              const isCurrent = proj.name === projectName;
              // 解决需求 1：展开状态使用独立记录的 expandedProjects，默认全部展开，切换会话不再收起
              const isExpanded = expandedProjects[proj.name] ?? true;
              const projSessions = proj.sessions || [];
              const isPinned = proj.is_pinned;

              const activeSessionIdx = projSessions.findIndex((s) => s.session_id === activeSessionId);
              const isShowAll = expandedMoreProjects[proj.name] ?? (isCurrent && activeSessionIdx >= 5);
              const shouldShowAll = isShowAll;
              const visibleSessions = shouldShowAll ? projSessions : projSessions.slice(0, 5);

              const isProjectDragging = isDragging && dragSource?.type === "project" && dragSource.id === proj.name;
              const isFolderDropTarget = dropTarget?.type === "folder" && dropTarget.targetProject === proj.name;

              return (
                <div 
                  key={proj.name} 
                  data-drag-project={proj.name}
                  className="space-y-0.5 group/proj relative"
                >
                  {/* 项目文件夹栏 (悬浮显示居中的 ... 按钮，支持长按拖拽排序与放入会话) */}
                  <div 
                    data-drag-project-folder={proj.name}
                    onMouseDown={(e) => handleItemMouseDown(e, { type: "project", id: proj.name, title: proj.name })}
                    onClick={() => {
                      if (justDroppedRef.current) return;
                      toggleProject(proj.name);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openProjectMenu({ name: proj.name, x: e.clientX, y: e.clientY });
                    }}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition relative border ${
                      isFolderDropTarget
                        ? "ring-2 ring-blue-500/80 bg-blue-50/80 dark:bg-blue-900/40 border-blue-400 text-blue-700 dark:text-blue-300"
                        : isCurrent 
                          ? "bg-[#e2e6eb] dark:bg-[#202535] text-gray-900 dark:text-blue-300 border-transparent dark:border-blue-500/20" 
                          : "border-transparent text-gray-700 dark:text-gray-400 hover:bg-[#eceef0] dark:hover:bg-[#181a24] hover:text-gray-900 dark:hover:text-gray-200"
                    } ${isProjectDragging ? "opacity-35 pointer-events-none" : ""}`}
                  >
                    {/* 拖拽插入蓝色指示线 (对标图二) */}
                    {dropTarget?.type === "project" && dropTarget.targetProject === proj.name && (
                      <DropIndicator position={dropTarget.position === "after" ? "bottom" : "top"} />
                    )}

                    <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-1">
                      {isExpanded ? <ChevronDown size={13} className="text-gray-400 shrink-0" /> : <ChevronRight size={13} className="text-gray-400 shrink-0" />}
                      <Folder size={14} className={isCurrent ? "text-blue-600 shrink-0" : "text-gray-500 shrink-0"} />
                      <span className="truncate">{proj.name}</span>
                      {isPinned && <Pin size={10} className="text-blue-600 shrink-0 rotate-45" />}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* 鼠标悬停显示 ... 居中操作按钮 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          openProjectMenu({ name: proj.name, x: rect.right, y: rect.bottom });
                        }}
                        className="opacity-0 group-hover/proj:opacity-100 hover:bg-gray-300/60 p-0.5 rounded text-gray-500 transition cursor-pointer"
                        title="项目操作"
                      >
                        <MoreHorizontal size={14} />
                      </button>

                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono px-1 rounded bg-gray-100 dark:bg-[#1c1f2b] shrink-0">
                        {projSessions.length}
                      </span>
                    </div>
                  </div>

                  {/* 展开后的会话列表项 */}
                  <div
                    className={`grid transition-all duration-200 ease-out ${
                      isExpanded 
                        ? "grid-rows-[1fr] opacity-100 mt-0.5" 
                        : "grid-rows-[0fr] opacity-0 pointer-events-none"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="pl-4 space-y-0.5 border-l-2 border-gray-200/80 dark:border-gray-800 ml-3 py-0.5">
                        {projSessions.length === 0 ? (
                          <div 
                            data-drag-empty-project={proj.name}
                            className={`px-2 py-1 text-[11px] rounded transition ${
                              isFolderDropTarget ? "bg-blue-50/80 dark:bg-blue-900/30 text-blue-600" : "text-gray-400 italic"
                            }`}
                          >
                            {isFolderDropTarget ? "释放将会话移入此工作区" : "暂无历史消息"}
                          </div>
                        ) : (
                          <>
                          {visibleSessions.map((s) => {
                            const isActive = isCurrent && s.session_id === activeSessionId;
                            const displayTitle = s.current_goal || (s.session_id === "default" ? "默认会话" : s.session_id);
                            const isSessionPinned = s.is_pinned;
                            const isThisDragging = isDragging && dragSource?.type === "session" && dragSource.id === s.session_id && dragSource.project === proj.name;

                            return (
                              <div
                                key={`${proj.name}-${s.session_id}`}
                                data-drag-session={s.session_id}
                                data-drag-session-project={proj.name}
                                onMouseDown={(e) => handleItemMouseDown(e, { type: "session", id: s.session_id, project: proj.name, title: displayTitle })}
                                onClick={() => {
                                  if (justDroppedRef.current) return;
                                  onSelectSession(s.session_id, proj.name);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  openSessionMenu({ project: proj.name, sid: s.session_id, x: e.clientX, y: e.clientY });
                                }}
                                className={`group/sess flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition relative border ${
                                  isActive
                                    ? "bg-blue-100/80 dark:bg-blue-900/30 text-blue-900 dark:text-blue-300 shadow-xs border-transparent dark:border-blue-700/30"
                                    : "border-transparent text-gray-600 dark:text-gray-400 hover:bg-[#eceef0] dark:hover:bg-[#181a24] hover:text-gray-900 dark:hover:text-gray-200"
                                } ${isThisDragging ? "opacity-35 pointer-events-none" : ""}`}
                              >
                                {/* 会话拖拽指示线 (对标图二) */}
                                {dropTarget?.type === "session" && dropTarget.targetSid === s.session_id && dropTarget.targetProject === proj.name && (
                                  <DropIndicator position={dropTarget.position === "after" ? "bottom" : "top"} />
                                )}

                                <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-1">
                                  {isSessionPinned && <Pin size={10} className="text-blue-600 shrink-0 rotate-45" />}
                                  <span className="truncate max-w-[125px]" title={displayTitle}>
                                    {displayTitle}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      openSessionMenu({ project: proj.name, sid: s.session_id, x: rect.right, y: rect.bottom });
                                    }}
                                    className="opacity-0 group-hover/sess:opacity-100 hover:bg-gray-300/60 p-0.5 rounded text-gray-500 transition cursor-pointer"
                                    title="会话操作"
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                  <span className="text-[10px] text-gray-400 shrink-0">
                                    {s.time_ago || "历史"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {projSessions.length > 5 && (
                            shouldShowAll ? (
                              <button
                                type="button"
                                onClick={() => setExpandedMoreProjects((prev) => ({ ...prev, [proj.name]: false }))}
                                className="w-full flex items-center gap-1 px-2.5 py-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-[#181a24] rounded-md transition cursor-pointer mt-0.5"
                              >
                                <ChevronUp size={12} />
                                <span>收起</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setExpandedMoreProjects((prev) => ({ ...prev, [proj.name]: true }))}
                                className="w-full flex items-center justify-between px-2.5 py-1 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-900/20 rounded-md transition font-medium cursor-pointer mt-0.5"
                              >
                                <span className="flex items-center gap-1">
                                  <ChevronDown size={12} />
                                  <span>展开显示</span>
                                </span>
                                <span className="text-[10px] text-gray-400">还有 {projSessions.length - 5} 项</span>
                              </button>
                            )
                          )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }))}
          </div>
          )}
          </div>

          {/* ================= 2. 下半部分：未分组 ∨ (对标图二 📁 未分组 与不在工作区的会话) ================= */}
          <div className="space-y-1 border-t border-gray-200/60 dark:border-[#1e222f] pt-2.5">
            <div 
              data-drag-recent-folder="_general"
              onClick={() => {
                if (justDroppedRef.current) return;
                handleToggleRecentHeader();
              }}
              className={`flex items-center justify-between px-1.5 py-1 text-xs text-gray-600 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-100/70 dark:hover:bg-[#1a1d27] transition cursor-pointer relative ${
                dropTarget?.type === "folder" && dropTarget.targetProject === "_general"
                  ? "ring-2 ring-blue-500/80 bg-blue-50/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                  : ""
              }`}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {isRecentExpanded ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                <Folder size={14} className="text-gray-500 shrink-0" />
                <span className="font-bold">未分组</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                  ({recentSessions.length})
                </span>
              </div>
              <div className="flex items-center gap-1 text-gray-400 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onNewRecentSession) {
                      onNewRecentSession();
                    } else {
                      onNewSession();
                    }
                  }}
                  className="p-1 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-200/60 dark:hover:bg-[#222534] rounded transition cursor-pointer"
                  title="新建独立对话"
                >
                  <Edit3 size={13} />
                </button>
              </div>
            </div>

            {isRecentExpanded && (
              <div className="space-y-0.5 pl-0.5 pb-2">
                {recentSessions.length === 0 ? (
                  <div 
                    data-drag-empty-project="_general"
                    className={`px-3 py-2 text-center text-xs rounded-lg transition ${
                      dropTarget?.type === "folder" && dropTarget.targetProject === "_general"
                        ? "bg-blue-50/80 dark:bg-blue-900/30 text-blue-600"
                        : "text-gray-400 dark:text-gray-500 italic"
                    }`}
                  >
                    {dropTarget?.type === "folder" && dropTarget.targetProject === "_general" ? "释放移入未分组" : "暂无独立对话"}
                  </div>
                ) : (
                  recentSessions.map((s) => {
                    const isRecentActive = (projectName === "" || projectName === "_general") && s.session_id === activeSessionId;
                    const displayTitle = s.current_goal || (s.session_id === "default" ? "独立对话" : s.session_id);
                    const isSessionPinned = s.is_pinned;
                    const isThisDragging = isDragging && dragSource?.type === "session" && dragSource.id === s.session_id && dragSource.project === "_general";

                    return (
                      <div
                        key={"recent-" + s.session_id}
                        data-drag-session={s.session_id}
                        data-drag-session-project="_general"
                        onMouseDown={(e) => handleItemMouseDown(e, { type: "session", id: s.session_id, project: "_general", title: displayTitle })}
                        onClick={() => {
                          if (justDroppedRef.current) return;
                          onSelectSession(s.session_id, "_general");
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openSessionMenu({ project: "_general", sid: s.session_id, x: e.clientX, y: e.clientY });
                        }}
                        className={`group/recent flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition relative ${
                          isRecentActive
                            ? "bg-blue-100/80 dark:bg-blue-900/40 text-blue-900 dark:text-blue-200 shadow-2xs"
                            : "text-gray-600 dark:text-gray-400 hover:bg-[#eceef0] dark:hover:bg-[#181a24] hover:text-gray-900 dark:hover:text-gray-200"
                        } ${isThisDragging ? "opacity-35 pointer-events-none" : ""}`}
                      >
                        {/* 未分组会话拖拽指示线 (对标图二) */}
                        {dropTarget?.type === "session" && dropTarget.targetSid === s.session_id && dropTarget.targetProject === "_general" && (
                          <DropIndicator position={dropTarget.position === "after" ? "bottom" : "top"} />
                        )}

                        <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-1">
                          {isSessionPinned && <Pin size={10} className="text-blue-600 shrink-0 rotate-45" />}
                          <span className="truncate max-w-[130px]" title={displayTitle}>
                            {displayTitle}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              openSessionMenu({ project: "_general", sid: s.session_id, x: rect.right, y: rect.bottom });
                            }}
                            className="opacity-0 group-hover/recent:opacity-100 hover:bg-gray-300/60 dark:hover:bg-[#282d3e] p-0.5 rounded text-gray-500 transition cursor-pointer"
                            title="会话操作"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {s.time_ago || "历史"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部功能区：插件市场与设置 */}
      <div className="p-3 border-t border-[#f1f3f5] dark:border-[#1e222f] space-y-0.5 shrink-0 bg-[#f8f9fa] dark:bg-[#10121a]">
        <button
          onClick={onOpenPlugins}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-[#eceef0] dark:hover:bg-[#181a24] transition-all duration-150 active:scale-[0.98] font-medium cursor-pointer"
        >
          <Puzzle size={16} className="text-gray-500 dark:text-gray-400" />
          <span>插件</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-[#eceef0] dark:hover:bg-[#181a24] transition-all duration-150 active:scale-[0.98] font-medium cursor-pointer"
        >
          <Settings size={16} className="text-gray-500 dark:text-gray-400" />
          <span>设置</span>
        </button>
      </div>

      {/* 拖拽跟随半透明阴影预览项 (对标图二) */}
      {isDragging && dragSource && (
        <div
          style={{
            position: "fixed",
            left: mousePos.x + 10,
            top: mousePos.y - 14,
            pointerEvents: "none",
            zIndex: 99999,
            width: 190,
          }}
          className="px-2.5 py-1.5 rounded-lg bg-gray-200/90 dark:bg-[#202535]/95 border border-blue-500/30 text-xs font-medium text-gray-800 dark:text-gray-100 shadow-xl flex items-center justify-between backdrop-blur-xs select-none"
        >
          <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 pr-1">
            {dragSource.type === "project" ? (
              <Folder size={13} className="text-blue-600 shrink-0" />
            ) : (
              <Folder size={13} className="text-gray-400 shrink-0" />
            )}
            <span className="truncate">{dragSource.title}</span>
          </div>
          <MoreHorizontal size={14} className="text-gray-400 shrink-0" />
        </div>
      )}

      {/* 1. 项目工作区操作下拉菜单 (带 300ms 淡入淡出及缩放过渡) */}
      <DropdownTransition
        isOpen={Boolean(activeProjectMenu)}
        onClose={() => setActiveProjectMenu(null)}
        zIndex={50}
        duration={300}
        origin="top-left"
        style={projectMenuSnapshot ? {
          position: "fixed",
          top: Math.min(projectMenuSnapshot.y, window.innerHeight - 150),
          left: Math.min(projectMenuSnapshot.x, window.innerWidth - 180)
        } : undefined}
        className="w-44 bg-white dark:bg-[#181a24] border border-gray-200 dark:border-[#2a2e3f] shadow-xl rounded-xl py-1 text-xs select-none text-gray-700 dark:text-gray-200"
      >
        {projectMenuSnapshot && (
          <>
            <button
              onClick={() => {
                const targetP = displayProjects.find((p) => p.name === projectMenuSnapshot.name);
                openEditProject({
                  oldName: projectMenuSnapshot.name,
                  newName: projectMenuSnapshot.name,
                  path: targetP?.path || ""
                });
                setActiveProjectMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#222534] text-gray-700 dark:text-gray-200 text-left transition cursor-pointer"
            >
              <Edit2 size={13} className="text-gray-500" />
              <span>编辑</span>
            </button>

            <button
              onClick={() => {
                const targetP = displayProjects.find((p) => p.name === projectMenuSnapshot.name);
                if (onPinProject) onPinProject(projectMenuSnapshot.name, !targetP?.is_pinned);
                setActiveProjectMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#222534] text-gray-700 dark:text-gray-200 text-left transition cursor-pointer"
            >
              {displayProjects.find((p) => p.name === projectMenuSnapshot.name)?.is_pinned ? (
                <>
                  <PinOff size={13} className="text-gray-500" />
                  <span>取消置顶</span>
                </>
              ) : (
                <>
                  <Pin size={13} className="text-blue-600" />
                  <span>置顶</span>
                </>
              )}
            </button>

            <div className="border-t border-gray-100 dark:border-gray-800 my-0.5" />

            <button
              onClick={() => {
                if (onDeleteProject) onDeleteProject(projectMenuSnapshot.name);
                setActiveProjectMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 text-left transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>删除</span>
            </button>
          </>
        )}
      </DropdownTransition>

      {/* 2. 会话操作下拉菜单 (带 300ms 淡入淡出及缩放过渡) */}
      <DropdownTransition
        isOpen={Boolean(activeSessionMenu)}
        onClose={() => setActiveSessionMenu(null)}
        zIndex={50}
        duration={300}
        origin="top-left"
        style={sessionMenuSnapshot ? {
          position: "fixed",
          top: Math.min(sessionMenuSnapshot.y, window.innerHeight - 150),
          left: Math.min(sessionMenuSnapshot.x, window.innerWidth - 180)
        } : undefined}
        className="w-40 bg-white dark:bg-[#181a24] border border-gray-200 dark:border-[#2a2e3f] shadow-xl rounded-xl py-1 text-xs select-none text-gray-700 dark:text-gray-200"
      >
        {sessionMenuSnapshot && (
          <>
            <button
              onClick={() => {
                const proj = displayProjects.find((p) => p.name === sessionMenuSnapshot.project);
                const sess = proj?.sessions.find((s) => s.session_id === sessionMenuSnapshot.sid);
                openRenameSession({
                  project: sessionMenuSnapshot.project,
                  sid: sessionMenuSnapshot.sid,
                  title: sess?.current_goal || sessionMenuSnapshot.sid
                });
                setActiveSessionMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#222534] text-gray-700 dark:text-gray-200 text-left transition cursor-pointer"
            >
              <Edit2 size={13} className="text-gray-500" />
              <span>重命名</span>
            </button>

            <button
              onClick={() => {
                const proj = displayProjects.find((p) => p.name === sessionMenuSnapshot.project);
                const sess = proj?.sessions.find((s) => s.session_id === sessionMenuSnapshot.sid);
                if (onPinSession) onPinSession(sessionMenuSnapshot.project, sessionMenuSnapshot.sid, !sess?.is_pinned);
                setActiveSessionMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#222534] text-gray-700 dark:text-gray-200 text-left transition cursor-pointer"
            >
              {(sessionMenuSnapshot.project === "_general" ? recentSessions : displayProjects.find((p) => p.name === sessionMenuSnapshot.project)?.sessions || []).find((s) => s.session_id === sessionMenuSnapshot.sid)?.is_pinned ? (
                <>
                  <PinOff size={13} className="text-gray-500" />
                  <span>取消置顶</span>
                </>
              ) : (
                <>
                  <Pin size={13} className="text-blue-600" />
                  <span>置顶</span>
                </>
              )}
            </button>

            <div className="border-t border-gray-100 dark:border-gray-800 my-0.5" />

            <button
              onClick={() => {
                if (onDeleteSession) onDeleteSession(sessionMenuSnapshot.project, sessionMenuSnapshot.sid);
                setActiveSessionMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 text-left transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>删除会话</span>
            </button>
          </>
        )}
      </DropdownTransition>

      {/* 3. 编辑项目工作区弹窗 (更改命名与磁盘目录，300ms 平滑缩放与淡入淡出) */}
      <ModalTransition
        isOpen={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        zIndex={100}
        duration={300}
      >
        {editingProjectSnapshot && (
          <div className="w-[420px] bg-white dark:bg-[#181a24] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2a2e3f] overflow-hidden p-5 space-y-4 text-xs text-gray-800 dark:text-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <span className="font-bold text-gray-900 dark:text-white text-sm">编辑项目工作区</span>
              <button onClick={() => setEditingProject(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-1">工作区命名</label>
              <input
                type="text"
                value={editingProjectSnapshot.newName}
                onChange={(e) => {
                  const updated = { ...editingProjectSnapshot, newName: e.target.value };
                  setEditingProject(updated);
                  setEditingProjectSnapshot(updated);
                }}
                className="w-full px-3 py-2 bg-white dark:bg-[#1c1f2b] border border-gray-200 dark:border-[#2a2e3f] text-gray-900 dark:text-gray-100 rounded-xl focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-1">磁盘对应目录</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingProjectSnapshot.path}
                  onChange={(e) => {
                    const updated = { ...editingProjectSnapshot, path: e.target.value };
                    setEditingProject(updated);
                    setEditingProjectSnapshot(updated);
                  }}
                  placeholder="本地绝对路径"
                  className="flex-1 px-3 py-2 bg-white dark:bg-[#1c1f2b] border border-gray-200 dark:border-[#2a2e3f] text-gray-900 dark:text-gray-100 rounded-xl focus:border-blue-500 outline-none truncate font-mono text-[11px]"
                />
                <button
                  type="button"
                  onClick={handleBrowseDir}
                  className="p-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-[#222534] rounded-xl transition cursor-pointer text-gray-600 dark:text-gray-300"
                  title="浏览选择文件夹"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="px-3.5 py-1.5 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-[#222534] rounded-xl transition cursor-pointer text-gray-600 dark:text-gray-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onEditProject && editingProjectSnapshot) {
                    onEditProject(editingProjectSnapshot.oldName, editingProjectSnapshot.newName, editingProjectSnapshot.path);
                  }
                  setEditingProject(null);
                }}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition cursor-pointer shadow-xs"
              >
                保存修改
              </button>
            </div>
          </div>
        )}
      </ModalTransition>

      {/* 4. 重命名会话弹窗 (300ms 平滑缩放与淡入淡出) */}
      <ModalTransition
        isOpen={Boolean(renamingSession)}
        onClose={() => setRenamingSession(null)}
        zIndex={100}
        duration={300}
      >
        {renamingSessionSnapshot && (
          <div className="w-[360px] bg-white dark:bg-[#181a24] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#2a2e3f] overflow-hidden p-5 space-y-4 text-xs text-gray-800 dark:text-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <span className="font-bold text-gray-900 dark:text-white text-sm">重命名会话</span>
              <button onClick={() => setRenamingSession(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-1">会话标题</label>
              <input
                type="text"
                value={renamingSessionSnapshot.title}
                onChange={(e) => {
                  const updated = { ...renamingSessionSnapshot, title: e.target.value };
                  setRenamingSession(updated);
                  setRenamingSessionSnapshot(updated);
                }}
                className="w-full px-3 py-2 bg-white dark:bg-[#1c1f2b] border border-gray-200 dark:border-[#2a2e3f] text-gray-900 dark:text-gray-100 rounded-xl focus:border-blue-500 outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setRenamingSession(null)}
                className="px-3.5 py-1.5 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-[#222534] rounded-xl transition cursor-pointer text-gray-600 dark:text-gray-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onRenameSession && renamingSessionSnapshot) {
                    onRenameSession(renamingSessionSnapshot.project, renamingSessionSnapshot.sid, renamingSessionSnapshot.title);
                  }
                  setRenamingSession(null);
                }}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition cursor-pointer shadow-xs"
              >
                确定
              </button>
            </div>
          </div>
        )}
      </ModalTransition>
    </aside>
  );
};
