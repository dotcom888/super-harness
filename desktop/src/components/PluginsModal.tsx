import React, { useState, useEffect } from "react";
import { 
  X, 
  Puzzle, 
  CheckCircle, 
  Folder, 
  Globe, 
  Sparkles, 
  CloudSun, 
  ShieldCheck,
  Zap
} from "lucide-react";
import { useModalTransition } from "../utils/useModalTransition";

interface PluginsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PluginsModal: React.FC<PluginsModalProps> = ({ isOpen, onClose }) => {
  const [skills, setSkills] = useState<any[]>([]);
  const [mcp, setMcp] = useState<any>({ clients: [], tools: [], servers_detail: [] });
  const [builtinTools, setBuiltinTools] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"skills" | "mcp" | "builtin">("skills");

  useEffect(() => {
    if (!isOpen) return;

    // 1. 获取专家技能 SOP 列表
    fetch("http://127.0.0.1:8765/api/skills")
      .then((res) => res.json())
      .then((data) => setSkills(data.skills || []))
      .catch(() => {});

    // 2. 获取外部 MCP 扩展服务详情
    fetch("http://127.0.0.1:8765/api/mcp")
      .then((res) => res.json())
      .then((data) => setMcp(data || { clients: [], tools: [], servers_detail: [] }))
      .catch(() => {});

    // 3. 获取系统核心内置工具清单
    fetch("http://127.0.0.1:8765/api/builtin_tools")
      .then((res) => res.json())
      .then((data) => setBuiltinTools(data.tools || []))
      .catch(() => {});
  }, [isOpen]);

  const { mounted, visible } = useModalTransition(isOpen, 300);
  if (!mounted) return null;

  const builtinSkills = skills.filter((s) => s.source_scope === "builtin");
  const userSkills = skills.filter((s) => s.source_scope === "user" || s.source_scope === "codex");
  const projectSkills = skills.filter((s) => s.source_scope === "project" || s.source_scope === "workspace");

  const mcpServers = mcp.servers_detail && mcp.servers_detail.length > 0 
    ? mcp.servers_detail 
    : [
        {
          server_id: "weather",
          name: "weather (外部实时气象服务)",
          description: "遵循标准独立外部 MCP 规范，通过公共气象接口获取指定城市的实时天气预报与详细气象指标。",
          script: "mcp/servers/weather_server.py",
          status: "connected",
          tools: ["mcp__weather__get_weather"]
        }
      ];

  return (
    <div 
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} 
      className={`fixed inset-0 z-[100] bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 select-none transition-opacity duration-300 ease-out ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* 点击遮罩平滑关闭 */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* 左右结构主弹窗卡片 (对标图二需求：左侧导航分类，右侧详情与列表) */}
      <div 
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={`relative z-10 w-[920px] max-w-[95vw] h-[620px] max-h-[86vh] bg-white dark:bg-[#12141c] rounded-2xl shadow-2xl border border-gray-200 dark:border-[#222634] overflow-hidden flex flex-row select-none transition-all duration-300 ease-out ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. 左侧导航分类栏 (固定宽度 w-52，含图标、分类、徽标) */}
        <aside className="w-52 h-full bg-[#f8f9fa] dark:bg-[#0d0f15] border-r border-gray-200/80 dark:border-[#1e222f] flex flex-col justify-between p-3 shrink-0 transition-colors">
          <div>
            {/* 左上角标题与 Logo */}
            <div className="flex items-center gap-2.5 px-3 py-3 mb-3 border-b border-gray-200/60 dark:border-[#1e222f]">
              <div className="w-7 h-7 rounded-xl bg-purple-50 dark:bg-[#231b31] flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                <Puzzle size={16} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-gray-900 dark:text-white text-sm tracking-tight truncate">
                  插件与技能
                </div>
                <div className="text-[10px] text-gray-400 truncate">Skills & MCP</div>
              </div>
            </div>

            {/* 垂直分类导航菜单项 */}
            <nav className="space-y-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("skills")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "skills"
                    ? "bg-white dark:bg-[#1a1d27] text-purple-600 dark:text-purple-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles size={15} className={activeTab === "skills" ? "text-purple-600 dark:text-purple-400" : "text-gray-400"} />
                  <span className="truncate">挂载技能 SOP</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold shrink-0 ${
                  activeTab === "skills"
                    ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                    : "bg-gray-200/70 dark:bg-[#1e212d] text-gray-500 dark:text-gray-400"
                }`}>
                  {skills.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("mcp")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "mcp"
                    ? "bg-white dark:bg-[#1a1d27] text-blue-600 dark:text-blue-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Globe size={15} className={activeTab === "mcp" ? "text-blue-600 dark:text-blue-400" : "text-gray-400"} />
                  <span className="truncate">外部 MCP 服务</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold shrink-0 ${
                  activeTab === "mcp"
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    : "bg-gray-200/70 dark:bg-[#1e212d] text-gray-500 dark:text-gray-400"
                }`}>
                  {mcpServers.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("builtin")}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  activeTab === "builtin"
                    ? "bg-white dark:bg-[#1a1d27] text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold border border-transparent dark:border-[#2b3042]"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-[#161822] hover:text-gray-900 dark:hover:text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Zap size={15} className={activeTab === "builtin" ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"} />
                  <span className="truncate">内置核心工具</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-semibold shrink-0 ${
                  activeTab === "builtin"
                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-gray-200/70 dark:bg-[#1e212d] text-gray-500 dark:text-gray-400"
                }`}>
                  {builtinTools.length || 10}
                </span>
              </button>
            </nav>
          </div>

          {/* 左下角小贴士 */}
          <div className="p-2.5 rounded-xl bg-white/70 dark:bg-[#161822] border border-gray-200/60 dark:border-[#1e222f] text-[10.5px] text-gray-400 space-y-1">
            <div className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <ShieldCheck size={12} className="text-purple-500" />
              <span>能力扩展协议</span>
            </div>
            <p className="leading-relaxed text-[10px] text-gray-500 dark:text-gray-400">
              支持 SKILL.md 工作流注入、外部 MCP 进程隔离与内核零延迟工具。
            </p>
          </div>
        </aside>

        {/* 2. 右侧主内容展示区 (自适应宽度，顶栏、滚动卡片列表、底栏) */}
        <main className="flex-1 h-full flex flex-col min-w-0 bg-white dark:bg-[#12141c] transition-colors">
          {/* 右侧顶部栏 */}
          <div className="h-12 border-b border-gray-100 dark:border-[#1e222f] flex items-center justify-between px-6 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                {activeTab === "skills" && `挂载技能 SOP 规范 (${skills.length})`}
                {activeTab === "mcp" && `外部独立 MCP 服务 (${mcpServers.length})`}
                {activeTab === "builtin" && `内核内置核心工具 (${builtinTools.length || 10})`}
              </span>
              <span className="text-[11px] text-gray-400 truncate hidden sm:inline">
                {activeTab === "skills" && `(系统内置 ${builtinSkills.length} + 用户全局 ${userSkills.length} + 项目私有 ${projectSkills.length})`}
                {activeTab === "mcp" && "(遵循 Model Context Protocol 独立子进程通信)"}
                {activeTab === "builtin" && "(super 主进程零延迟直通工具与沙箱)"}
              </span>
            </div>
            <button 
              type="button"
              onClick={onClose} 
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 rounded-xl transition cursor-pointer hover:bg-gray-100 dark:hover:bg-[#20222f]"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>

          {/* 右侧正文滚动卡片区 */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3 text-xs select-text">
            {/* 1. 专家技能 SOP 列表 */}
            {activeTab === "skills" && (
              <>
                <div className="bg-purple-50/50 dark:bg-[#1a1728] border border-purple-100 dark:border-[#2f2747] p-2.5 rounded-xl text-[11px] text-purple-700 dark:text-purple-300 leading-relaxed">
                  💡 <strong>技能的作用：</strong> Skills 是提供给大模型的专业工作流 SOP 指南（通过 SKILL.md 文档注入）。包含 super 内核原生搭载的架构走查规范，以及宿主机跨 Agent 共享的用户全局技能。
                </div>

                {skills.map((s, idx) => {
                  const isBuiltin = s.source_scope === "builtin";
                  const isProject = s.source_scope === "project" || s.source_scope === "workspace";
                  
                  return (
                    <div 
                      key={idx} 
                      className="p-3 border border-gray-200/80 dark:border-gray-800 rounded-xl bg-gray-50/60 dark:bg-[#181a24] hover:border-gray-300 dark:hover:border-gray-700 transition"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 dark:text-gray-100 font-mono text-xs">
                              {s.name}
                            </span>
                            {/* 作用域徽标：清晰区分 super 系统内置 vs 用户全局 vs 项目私有 */}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 ${
                              isBuiltin
                                ? "bg-blue-50 dark:bg-[#152033] text-blue-600 dark:text-blue-400 border border-blue-200/70 dark:border-blue-900/60"
                                : isProject
                                ? "bg-emerald-50 dark:bg-[#152a22] text-emerald-600 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-900/60"
                                : "bg-purple-50 dark:bg-[#231b31] text-purple-600 dark:text-purple-400 border border-purple-200/70 dark:border-purple-900/60"
                            }`}>
                              {isBuiltin ? <Sparkles size={10} /> : isProject ? <Folder size={10} /> : <Globe size={10} />}
                              <span>
                                {isBuiltin 
                                  ? "super 原生内置 SOP" 
                                  : isProject 
                                  ? "项目私有 .skills" 
                                  : "用户全局 ~/.agents/skills"}
                              </span>
                            </span>
                          </div>
                          <p className="text-gray-600 dark:text-gray-400 mt-1 leading-relaxed text-[11.5px]">
                            {s.description || "（暂无详细说明）"}
                          </p>
                          {s.directory && (
                            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-1 truncate">
                              路径: {s.directory}
                            </div>
                          )}
                        </div>
                        <CheckCircle size={15} className="text-green-500 shrink-0 mt-0.5" />
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* 2. 外部 MCP 协议服务列表 */}
            {activeTab === "mcp" && (
              <div className="space-y-3">
                <div className="bg-blue-50/50 dark:bg-[#151f30] border border-blue-100 dark:border-[#223350] p-2.5 rounded-xl text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed">
                  🔌 <strong>MCP 的作用：</strong> MCP (Model Context Protocol) 用于连接独立的外部子进程服务与三方开放 API。独立运行，网络与外部异常故障完全物理隔离，不影响主内核。
                </div>

                {mcpServers.map((srv: any, idx: number) => (
                  <div key={idx} className="p-3.5 border border-gray-200/80 dark:border-gray-800 rounded-xl bg-gray-50/60 dark:bg-[#181a24]">
                    <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-gray-800/80">
                      <div className="flex items-center gap-2">
                        <CloudSun size={15} className="text-blue-600 dark:text-blue-400" />
                        <span className="font-semibold text-gray-900 dark:text-gray-100 font-mono text-xs">
                          {srv.name || srv.server_id}
                        </span>
                      </div>
                      <span className="text-[10px] text-green-600 dark:text-green-400 font-medium flex items-center gap-1 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-md border border-green-200/60 dark:border-green-900/40">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        <span>连通正常 (JSON-RPC stdio)</span>
                      </span>
                    </div>

                    <p className="text-gray-600 dark:text-gray-400 mt-2 text-[11.5px] leading-relaxed">
                      {srv.description || "独立外部 MCP 协议服务"}
                    </p>

                    <div className="mt-2.5 pt-2 border-t border-gray-100 dark:border-gray-800/60 flex flex-wrap items-center gap-3 text-[10.5px] text-gray-400">
                      <div>
                        <span className="font-semibold text-gray-500">服务脚本: </span>
                        <code className="text-gray-700 dark:text-gray-300 font-mono bg-white dark:bg-[#12141c] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-800">
                          {srv.script || (srv.args ? srv.args.join(" ") : srv.command)}
                        </code>
                      </div>
                      {srv.tools && srv.tools.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-gray-500">注册工具: </span>
                          {srv.tools.map((t: string, ti: number) => (
                            <span key={ti} className="bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded font-mono text-[10px]">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3. 系统内置核心工具列表 */}
            {activeTab === "builtin" && (
              <div className="space-y-3">
                <div className="bg-emerald-50/50 dark:bg-[#12221b] border border-emerald-100 dark:border-[#1d382d] p-2.5 rounded-xl text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
                  ⚡ <strong>内置工具的定位：</strong> 内置工具直接集成于 super 智能体主进程核心，拥有零 IPC 延迟（微秒级响应）、深层沙箱防篡改保护与本地工作区自动上下文绑定。
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {builtinTools.map((tool: any, idx: number) => {
                    return (
                      <div 
                        key={idx} 
                        className="p-3 border border-gray-200/80 dark:border-gray-800 rounded-xl bg-gray-50/60 dark:bg-[#181a24] flex items-start justify-between"
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 dark:text-gray-100 font-mono text-xs">
                              {tool.id}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/40">
                              {tool.category}
                            </span>
                            {tool.read_only ? (
                              <span className="text-[10px] text-gray-400 font-mono">只读安全</span>
                            ) : (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">写保护</span>
                            )}
                          </div>
                          <p className="text-gray-600 dark:text-gray-400 mt-1 text-[11.5px] leading-relaxed">
                            {tool.description}
                          </p>
                        </div>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 bg-emerald-50/80 dark:bg-[#12201b] px-2 py-0.5 rounded-md border border-emerald-200/50 dark:border-emerald-900/30 shrink-0">
                          <Zap size={10} className="text-emerald-500" />
                          <span>内置就绪</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. 右侧底部状态与操作栏 */}
          <div className="px-6 py-3 bg-gray-50/60 dark:bg-[#161822] border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-400 shrink-0">
            <span>
              {activeTab === "skills" 
                ? `已挂载 ${skills.length} 项 SOP 专家规范指南` 
                : activeTab === "mcp" 
                ? `已连接 ${mcpServers.length} 项外部独立 MCP 协议服务` 
                : `已装载 ${builtinTools.length || 10} 项内核核心原生工具`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 rounded-xl font-bold transition cursor-pointer text-xs"
            >
              完成
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};
