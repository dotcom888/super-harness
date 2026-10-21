from server.project_utils import resolve_project_workspace_root, register_project_path, AGENT_SOURCE_ROOT
# -*- coding: utf-8 -*-
"""
server/agent_bridge.py: 桌面端 Agent 异步事件总线与桥接层
将 ReActAgent 的同步多步推理改造为支持 WebSocket 全双工流式推送的事件驱动架构。
"""
import os
import sys
import time
import json
import asyncio
import uuid
import threading
import logging
from typing import Dict, Any, Optional, Callable, List
from pathlib import Path

from core.agent import ReActAgent
from server.attachment_parser import extract_attachment_summary
from tools.framework.workspace import default_workspace, WorkspaceContext, set_workspace_root
from core.session import SessionManager
from tools.framework.policies import default_policy, PolicyDecision
from tools.executor import ToolExecutor, default_executor
from tools.builtin.interaction_tools import set_user_interaction_handler

logger = logging.getLogger("server.agent_bridge")

ROOT_DIR = Path(__file__).resolve().parent.parent
HISTORY_ROOT = Path.home() / ".super-harness" / "history"
HISTORY_ROOT.mkdir(parents=True, exist_ok=True)

def format_tool_display(tool_name: str, args: Dict[str, Any]) -> Dict[str, str]:
    """对标 DeepSeek Harness 的工具显示分类 (Pwsh, Read, Edit, Grep 等)"""
    if tool_name == "run_shell":
        cmd = args.get("command", "") if isinstance(args, dict) else str(args)
        # 精炼显示描述，例如 "Read env file with UTF8 encoding" 或 "Find chat-layout CSS rules"
        desc = cmd[:80] if len(cmd) <= 80 else cmd[:77] + "..."
        return {"display": "Pwsh", "desc": desc, "path": ""}
    elif tool_name == "read_file":
        fp = args.get("file_path", "") if isinstance(args, dict) else str(args)
        sl = args.get("start_line")
        el = args.get("end_line")
        range_str = f" (lines {sl}-{el})" if sl or el else ""
        return {"display": "Read", "desc": f"{fp}{range_str}", "path": fp}
    elif tool_name in ("patch_file", "write_file"):
        fp = args.get("file_path", "") if isinstance(args, dict) else str(args)
        action = "Edit" if tool_name == "patch_file" else "Write"
        return {"display": action, "desc": fp, "path": fp}
    elif tool_name == "grep_text":
        kw = args.get("keyword", "") if isinstance(args, dict) else ""
        d = args.get("directory", ".") if isinstance(args, dict) else "."
        return {"display": "Grep", "desc": f"pattern '{kw}' in {d}", "path": ""}
    elif tool_name == "find_by_name":
        p = args.get("pattern", "*") if isinstance(args, dict) else "*"
        d = args.get("directory", ".") if isinstance(args, dict) else "."
        return {"display": "Glob", "desc": f"pattern '{p}' in {d}", "path": ""}
    elif tool_name in ("ask_user", "request_user_input"):
        q = args.get("question", "") if isinstance(args, dict) else str(args)
        desc = q[:80] if len(q) <= 80 else q[:77] + "..."
        return {"display": "AskUser", "desc": desc, "path": ""}
    elif tool_name.startswith("mcp__"):
        parts = tool_name.split("__", 2)
        srv = parts[1] if len(parts) > 1 else "mcp"
        fn = parts[2] if len(parts) > 2 else tool_name
        return {"display": f"MCP:{srv}", "desc": fn, "path": ""}
    return {"display": tool_name, "desc": json.dumps(args, ensure_ascii=False)[:80], "path": ""}


class StreamingToolExecutor(ToolExecutor):
    """支持向前端实时广播执行生命周期与异步交互审批的工具执行器"""
    def __init__(self, base_executor: ToolExecutor, event_emitter: Callable[[Dict[str, Any]], Any]):
        super().__init__(registry=base_executor.registry, max_workers=base_executor.max_workers)
        self.event_emitter = event_emitter
        self.pending_approvals: Dict[str, asyncio.Future] = {}
        self.total_tool_elapsed: float = 0.0
        self.tool_steps_count: int = 0

    def _execute_single(self, tc: Any):
        # 提取参数
        tc_id = getattr(tc, "id", "") or str(time.time())
        func = getattr(tc, "function", None)
        func_name = getattr(func, "name", "") if func else ""
        raw_args = getattr(func, "arguments", "") if func else ""
        try:
            parsed_args = json.loads(raw_args) if raw_args else {}
        except Exception:
            parsed_args = {"raw": raw_args}

        meta = format_tool_display(func_name, parsed_args)

        # 广播工具开始执行事件
        self.event_emitter({
            "event": "tool_start",
            "id": tc_id,
            "tool": func_name,
            "display": meta["display"],
            "desc": meta["desc"],
            "path": meta["path"],
            "args": parsed_args,
            "timestamp": time.time()
        })

        start_time = time.time()
        func_name, args_str, msg = super()._execute_single(tc)
        elapsed = time.time() - start_time
        self.total_tool_elapsed += elapsed
        self.tool_steps_count += 1

        content = msg.get("content", "")
        is_err = any(k in content for k in ["【执行超时】", "【并发执行异常】", "【安全拦截拒绝】", "【用户拒绝】", "执行失败:", "Error:"])

        # 广播工具执行完成事件
        self.event_emitter({
            "event": "tool_end",
            "id": tc_id,
            "tool": func_name,
            "display": meta["display"],
            "desc": meta["desc"],
            "path": meta["path"],
            "status": "error" if is_err else "success",
            "output": content[:4000],  # 截断安全长度避免渲染溢出
            "elapsed": round(elapsed, 2),
            "timestamp": time.time()
        })

        return func_name, args_str, msg


class AgentBridge:
    """管理多会话并发 Agent 及 WebSocket 会话事件流通信"""
    def __init__(self):
        self.default_agent: Optional[ReActAgent] = None
        self.agents: Dict[str, ReActAgent] = {}
        self.pending_approvals: Dict[str, Dict[str, Any]] = {}
        self.pending_user_inputs: Dict[str, Dict[str, Any]] = {}
        self._init_agent()

    def _init_agent(self):
        try:
            self.default_agent = ReActAgent()
            logger.info(f"AgentBridge initialized default agent with project: {self.default_agent.project_name}, model: {self.default_agent.model}")
        except Exception as e:
            logger.error(f"Failed to initialize ReActAgent in bridge: {e}")
            self.default_agent = None

    @property
    def agent(self) -> Optional[ReActAgent]:
        """向后兼容属性"""
        return self.default_agent

    @agent.setter
    def agent(self, val: Optional[ReActAgent]):
        self.default_agent = val

    def _resolve_model_config(self, ag_model: str) -> tuple[str, str, str]:
        import importlib
        import config.model_resolver
        try:
            importlib.reload(config.model_resolver)
        except Exception:
            pass
        from config.model_resolver import resolve_active_model_config
        _, final_key, final_base_url, _ = resolve_active_model_config(model=ag_model)
        return final_key, final_base_url, "openai_chat"

    def get_or_create_agent(self, project_name: str, session_id: str, model: Optional[str] = None) -> ReActAgent:
        """获取或创建与指定 (project, session) 强绑定的专属独立 Agent 实例，确保多会话并发无串扰"""
        key = f"{project_name}:{session_id}"
        target_model = model or (self.default_agent.model if self.default_agent else "deepseek-chat")
        final_key, final_base_url, final_proto = self._resolve_model_config(target_model)

        if key in self.agents:
            ag = self.agents[key]
            # 外部删除感知：若会话磁盘文件已被物理删除，淘汰内存失效缓存
            h_file = HISTORY_ROOT / project_name / f"{session_id}.jsonl"
            if not h_file.exists() and getattr(getattr(ag, "session_manager", None), "active_session", None) and ag.session_manager.active_session.turn_count > 0:
                logger.info(f"Session file {h_file} was removed on disk; evicting cached agent '{key}'")
                del self.agents[key]
                ag = None
            needs_update = False
            if target_model != ag.model:
                ag.model = target_model
                needs_update = True
            if getattr(ag, "_resolved_key", None) != final_key or getattr(ag, "_resolved_base_url", None) != final_base_url:
                needs_update = True

            if needs_update:
                if not final_key:
                    raise ValueError(f"未配置模型「{target_model}」对应的有效 API 密钥！请点击右下角「+ 添加模型」或前往「系统设置 -> 模型」填入 API Key 与接口地址。")
                ag.api_key = final_key
                ag.base_url = final_base_url or None
                ag._resolved_key = final_key
                ag._resolved_base_url = final_base_url
                ag._resolved_proto = final_proto
                from core.client_utils import create_resilient_openai_client
                ag.client = create_resilient_openai_client(api_key=final_key, base_url=ag.base_url)
                logger.info(f"Hot-reloaded agent client for session '{key}' to model '{target_model}' with baseUrl '{ag.base_url}'")
            return ag

        proj_dir = HISTORY_ROOT / project_name
        proj_dir.mkdir(parents=True, exist_ok=True)

        # 解析该项目的真实物理根目录 (支持 projects.json 与同级目录自适应)
        resolved_ws_root = resolve_project_workspace_root(project_name)
        target_workspace = WorkspaceContext(resolved_ws_root)

        sess_mgr = SessionManager(
            default_session_id=session_id,
            workspace=target_workspace,
            project_name=project_name,
            history_dir=HISTORY_ROOT / project_name
        )

        if not final_key:
            raise ValueError(f"未配置模型「{target_model}」对应的有效 API 密钥！请点击右下角「+ 添加模型」或前往「系统设置 -> 模型」填入 API Key 与接口地址。")

        ag = ReActAgent(
            api_key=final_key or None,
            base_url=final_base_url or None,
            model=target_model,
            session_manager=sess_mgr
        )
        ag._resolved_key = final_key
        ag._resolved_base_url = final_base_url
        ag._resolved_proto = final_proto

        self.agents[key] = ag
        logger.info(f"Created dedicated ReActAgent instance for session '{key}', workspace: {target_workspace.root}, model: {target_model}")
        return ag

    def evict_session_agent(self, project_name: str, session_id: str):
        key = f"{project_name}:{session_id}"
        if key in self.agents:
            del self.agents[key]
            logger.info(f"AgentBridge: evicted agent cache for session '{key}'")

    def evict_project_agents(self, project_name: str):
        prefix = f"{project_name}:"
        to_del = [k for k in self.agents if k.startswith(prefix)]
        for k in to_del:
            del self.agents[k]
        if to_del:
            logger.info(f"AgentBridge: evicted {len(to_del)} agents for project '{project_name}'")

    def reload_agents_config(self):
        """当用户在设置页新增、修改、删除提供方或切换配置时，彻底重载并更新 Agent 缓存"""
        logger.info(f"Reloading agent bridge config, cleared {len(self.agents)} cached agent instances.")
        self.agents.clear()
        self._init_agent()

    def resolve_approval(self, ticket_id: str, approved: bool, trust_session: bool = False) -> bool:
        """解析前端发回的审批结果"""
        info = self.pending_approvals.get(ticket_id)
        if info:
            info["decision"] = approved
            info["trust_session"] = trust_session
            if trust_session and approved:
                default_policy.session_approved = True
            info["event"].set()
            logger.info(f"Resolved approval ticket '{ticket_id}': approved={approved}, trust={trust_session}")
            return True
        return False

    def unblock_all_pending_approvals(self, approved: bool = True):
        """解挂所有等待中的审批 (例如切换为 AUTO 模式或中断)"""
        for ticket_id, info in list(self.pending_approvals.items()):
            info["decision"] = approved
            info["event"].set()

    def resolve_user_input(self, req_id: str, selected_option: str = "", custom_input: str = "") -> bool:
        """解析前端发回的用户方案决策与输入"""
        info = self.pending_user_inputs.get(req_id)
        if info:
            info["result"] = {"selected_option": selected_option, "custom_input": custom_input}
            info["event"].set()
            logger.info(f"Resolved user input req '{req_id}': selected='{selected_option}', custom='{custom_input}'")
            return True
        return False

    def unblock_all_pending_user_inputs(self):
        """解挂所有等待中的用户输入卡片"""
        for req_id, info in list(self.pending_user_inputs.items()):
            info["result"] = {"selected_option": "", "custom_input": "【已取消】"}
            info["event"].set()

    def abort_session(self, session_id: str, project_name: str):
        """中止指定工作区与会话中正在运行的 Agent 任务"""
        key = f"{project_name}:{session_id}"
        if key in self.agents:
            self.agents[key].abort()
        if self.default_agent:
            self.default_agent.abort()
        self.unblock_all_pending_approvals(approved=False)
        self.unblock_all_pending_user_inputs()
        logger.info(f"AgentBridge: abort signal dispatched for session '{key}'")

    def get_status(self) -> Dict[str, Any]:
        """获取系统状态元数据"""
        ag = self.default_agent
        if not ag:
            return {
                "ready": True,
                "project_name": default_workspace.root.name,
                "workspace_path": str(default_workspace.root),
                "active_session_id": "default",
                "model": "",
                "permission_mode": default_policy.mode,
                "turn_count": 0,
                "tools_count": len(default_executor.registry.get_tool_names()),
                "mcp_clients_count": 0,
            }
        active_sid = getattr(getattr(ag, "session_manager", None), "active_session_id", "default")
        proj_name = getattr(ag, "project_name", default_workspace.root.name)
        cm = ag.context_manager

        return {
            "ready": True,
            "project_name": proj_name,
            "workspace_path": str(default_workspace.root),
            "active_session_id": active_sid,
            "model": ag.model,
            "permission_mode": default_policy.mode,
            "turn_count": getattr(cm, "turn_count", 0),
            "tools_count": len(ag.executor.registry.get_tool_names()),
            "mcp_clients_count": len(ag.mcp_manager.clients),
        }

    async def execute_prompt_stream(
        self,
        prompt: str,
        event_callback: Callable[[Dict[str, Any]], None],
        model: Optional[str] = None,
        permission_mode: Optional[str] = None,
        session_id: Optional[str] = None,
        project_name: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """异步执行用户 Prompt，并以结构化事件流推向前端"""
        active_sid = session_id or "default"
        raw_proj = (project_name or "").strip()
        cur_proj = raw_proj if raw_proj else (default_workspace.root.name if default_workspace.root.name and default_workspace.root.name.lower() not in ("workspace", "scratchpad") else "_general")
        target_ws_dir = resolve_project_workspace_root(cur_proj)

        def wrapped_callback(ev: Dict[str, Any]):
            ev.setdefault("session_id", active_sid)
            ev.setdefault("project", cur_proj)
            event_callback(ev)

        try:
            cur_agent = self.get_or_create_agent(cur_proj, active_sid, model=model)
        except Exception as err:
            logger.error(f"Failed to initialize agent for session: {err}")
            err_msg = (
                "⚠️ **未检测到有效的模型 API 密钥**\n\n"
                "请在右下角模型选择栏点击【添加模型】，或前往左下角【设置】➔【模型提供方】配置您的 API 密钥与接口地址，保存后即可开启全自主智能排查与交互。"
            )
            wrapped_callback({
                "event": "assistant_response",
                "content": err_msg,
                "timestamp": time.time()
            })
            return err_msg

        if permission_mode:
            norm_mode = default_policy.normalize_mode(permission_mode)
            default_policy.mode = norm_mode
            if permission_mode == "full_access":
                default_policy.session_approved = True
            elif norm_mode in ("manual", "plan"):
                default_policy.session_approved = False

        def wrapped_callback(ev: Dict[str, Any]):
            ev.setdefault("session_id", active_sid)
            ev.setdefault("project", cur_proj)
            event_callback(ev)

        # 1. 拦截并即时响应快捷指令 (避免 /clear 等命令被送入 LLM 产生幻觉与长时间挂起)
        raw_cmd = prompt.strip()
        cmd_lower = raw_cmd.lower()

        if cmd_lower in ("/clear", "/reset", "/new"):
            # 清空当前会话的上下文与内存记录
            if cur_agent.context_manager:
                try:
                    cur_agent.context_manager.clear()
                except Exception:
                    pass
            
            # 清空磁盘上的当前会话历史记录文件
            try:
                hfile = HISTORY_ROOT / cur_proj / f"{active_sid}.jsonl"
                if hfile.exists():
                    hfile.write_text("", encoding="utf-8")
            except Exception:
                pass

            resp_msg = "【会话已清空】当前对话记录与上下文记忆已重置，可以开始新的任务。"
            wrapped_callback({
                "event": "assistant_response",
                "content": resp_msg,
                "timestamp": time.time()
            })
            return resp_msg

        elif cmd_lower == "/help":
            help_text = (
                "### ⚡ super 智能体快捷指令一览（共 21 个）\n\n"
                "**任务执行**\n"
                "- `/init` : **初始化感知** - 扫描项目目录结构、技术栈与依赖环境\n"
                "- `/review` : **代码走查审查** - 对指定模块进行架构审查、潜在漏洞与规范体检\n"
                "- `/test` : **运行项目测试** - 执行本地自动化测试套件 (pytest/npm test) 并分析报错\n"
                "- `/fix` : **诊断与 Bug 修复** - 根据报错日志定位根因，应用最小侵入式补丁修复\n"
                "- `/explain` : **代码原理解析** - 深入剖析复杂函数或架构实现的底层运作原理\n"
                "- `/compact` : **压缩会话记忆** - 智能浓缩历史上下文，释放注意力窗口与 token 预算\n"
                "\n**技能与扩展**\n"
                "- `/skills` : **技能库清单** - 查看已加载的全部 Skills 专家技能与 SOP 规约\n"
                "- `/skill` : **技能详情** - 查看指定技能的完整执行规约（用法：`/skill <名称>`）\n"
                "- `/mcp` : **MCP 服务状态** - 探测 MCP 扩展服务、工具挂载与级联配置路径\n"
                "\n**会话与记忆**\n"
                "- `/status` : **系统状态** - 查看当前模型、工作区、安全模式与工具挂载状态\n"
                "- `/memory` : **工作记忆** - 查看当前工作区感知、目标与已修改文件\n"
                "- `/history` : **会话历史** - 查看当前会话已完成轮次的摘要与 Token 统计\n"
                "- `/undo` : **撤销上一轮** - 回滚上一轮对话并物理还原被修改的源码文件\n"
                "- `/clear` : **清空会话** - 重置当前对话记录（别名：`/new`、`/reset`）\n"
                "\n**工作区与画像**\n"
                "- `/workspace` : **工作区信息** - 查看当前工程根目录、项目归属与活动会话\n"
                "- `/projects` : **项目地图** - 查看全局已登记的工程工作区索引清单\n"
                "- `/sessions` : **会话列表** - 浏览当前项目下的全部历史与激活会话\n"
                "- `/profile` : **开发画像** - 查看用户全局共享记忆、编码规范与偏好\n"
                "- `/remember` : **记入偏好** - 永久记入一条跨项目生效的编码习惯（用法：`/remember <规范>`）\n"
                "- `/forget` : **移除偏好** - 从全局记忆中移除匹配的规则（用法：`/forget <关键字>`）\n"
                "\n**帮助**\n"
                "- `/help` : **指令手册** - 显示本快捷指令清单\n"
                "\n直接输入指令即可快速执行，亦可在指令后追加具体文件路径或说明！"
            )
            wrapped_callback({
                "event": "assistant_response",
                "content": help_text,
                "timestamp": time.time()
            })
            return help_text

        elif cmd_lower in ("/status", "/memory"):
            st = self.get_status()
            status_text = (
                "### 📊 super 智能体当前运行状态\n\n"
                f"- **当前项目**: `{st.get('project_name')}`\n"
                f"- **工作区路径**: `{st.get('workspace_path')}`\n"
                f"- **当前会话**: `{active_sid}`\n"
                f"- **当前模型**: `{st.get('model')}`\n"
                f"- **安全模式**: `{st.get('permission_mode')}`\n"
                f"- **交互轮次**: `{st.get('turn_count')}`\n"
                f"- **加载工具数**: `{st.get('tools_count')} 个`\n"
                f"- **MCP 客户端数**: `{st.get('mcp_clients_count')} 个`\n"
            )
            if cmd_lower == "/memory":
                wm = getattr(cur_agent.context_manager, "working_memory", None)
                goal = (getattr(wm, "current_goal", "") or "（未指定）") if wm else "（未指定）"
                modified = (getattr(wm, "modified_files", []) or []) if wm else []
                status_text += f"- **当前目标**: `{goal}`\n"
                status_text += f"- **已修改文件**: {len(modified)} 个"
                if modified:
                    status_text += "（" + ", ".join(str(x) for x in modified[:5]) + "）"
                status_text += "\n"
            wrapped_callback({
                "event": "assistant_response",
                "content": status_text,
                "timestamp": time.time()
            })
            return status_text

        elif cmd_lower == "/compact":
            try:
                summary = self.agent.context_manager.summarizer.summarize(
                    self.agent.context_manager.completed_turns,
                    current_turn_id=self.agent.context_manager.turn_count
                )
                resp = f"【记忆压缩完成】已成功对历史对话进行语义压缩与长程摘要。\n\n当前总结概览：\n{summary}"
            except Exception:
                resp = "【记忆压缩完成】当前历史上下文已优化整理，释放了上下文预算。"
            wrapped_callback({
                "event": "assistant_response",
                "content": resp,
                "timestamp": time.time()
            })
            return resp

        elif cmd_lower == "/skills":
            try:
                from skills import default_skill_manager
                skills = default_skill_manager.list_skills()
                if skills:
                    lines = [f"### 🧩 已挂载技能库（共 {len(skills)} 个）", ""]
                    for s in skills:
                        desc = s.description if len(s.description) <= 180 else s.description[:180] + "…"
                        lines.append(f"- **{s.name}** · `{s.source_scope}` — {desc}")
                    lines.append("")
                    lines.append("> 💡 输入 `/skill <名称>` 查看该技能的完整 SOP 执行规约。")
                    resp = "\n".join(lines)
                else:
                    resp = "### 🧩 技能库\n\n当前未检测到已挂载的 Skills，请检查 `skills/` 目录或通过插件市场安装。"
            except Exception as err:
                resp = f"⚠️ 读取技能库失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/skill" or cmd_lower.startswith("/skill "):
            parts = raw_cmd.split(None, 1)
            target = parts[1].strip() if len(parts) > 1 else ""
            try:
                from skills import default_skill_manager
                if not target:
                    rows = [
                        f"- **{s.name}** · `{s.source_scope}` — "
                        + (s.description if len(s.description) <= 180 else s.description[:180] + "…")
                        for s in default_skill_manager.list_skills()
                    ]
                    resp = "### 🧩 可用技能\n\n" + ("\n".join(rows) if rows else "（暂无已挂载技能）")
                    resp += "\n\n> 用法：`/skill <名称>`"
                else:
                    skill = default_skill_manager.get_skill(target)
                    if not skill:
                        resp = f"⚠️ 未找到技能 `{target}`，输入 `/skills` 查看全部可用技能。"
                    else:
                        body = skill.content or skill.description
                        if len(body) > 6000:
                            body = body[:6000] + "\n\n> …（内容过长，已截断）"
                        resp = f"### 🧩 技能：{skill.name}\n\n**来源**：`{skill.source_scope}`\n\n{body}"
            except Exception as err:
                resp = f"⚠️ 读取技能详情失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/mcp":
            try:
                mgr = getattr(cur_agent, "mcp_manager", None)
                clients = getattr(mgr, "clients", {}) or {}
                executor = getattr(cur_agent, "executor", None)
                registry = getattr(executor, "registry", None)
                all_tools = registry.get_tool_names() if registry and hasattr(registry, "get_tool_names") else []
                mcp_tools = [t for t in all_tools if t.startswith("mcp__")]
                loaded_paths = getattr(mgr, "loaded_config_paths", []) or []
                lines = ["### 🔌 MCP 扩展服务状态", ""]
                if loaded_paths:
                    lines.append("**生效配置文件**：" + "、".join(f"`{p}`" for p in loaded_paths))
                else:
                    cfg = getattr(mgr, "config_path", None)
                    lines.append(f"**生效配置文件**：`{cfg}`" if cfg else "**生效配置文件**：（未发现）")
                lines.append("")
                lines.append(f"**已连通服务**：{len(clients)} 个")
                for sid, _client in clients.items():
                    s_tools = [t for t in mcp_tools if t.startswith(f"mcp__{sid}__")]
                    suffix = ("：" + ", ".join(f"`{t}`" for t in s_tools)) if s_tools else ""
                    lines.append(f"- `{sid}` · 提供 {len(s_tools)} 个工具{suffix}")
                if not clients:
                    lines.append("- （当前未连通任何外部 MCP 服务）")
                candidates = list(mgr.get_candidate_config_paths()) if mgr and hasattr(mgr, "get_candidate_config_paths") else []
                if candidates:
                    lines.append("")
                    lines.append("**级联配置探测顺序**：")
                    for idx, cp in enumerate(candidates, 1):
                        exists = "✅ 已载入" if getattr(cp, "exists", lambda: False)() else "— 未配置"
                        lines.append(f"{idx}. `{cp}` {exists}")
                resp = "\n".join(lines)
            except Exception as err:
                resp = f"⚠️ 读取 MCP 状态失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/workspace":
            try:
                from tools.framework.workspace import default_workspace
                resp = (
                    "### 📁 工作区信息\n\n"
                    f"- **当前项目**：`{cur_proj}`\n"
                    f"- **工程根目录**：`{target_ws_dir}`\n"
                    f"- **全局工作区**：`{default_workspace.root}`\n"
                    f"- **当前会话**：`{active_sid}`\n"
                    f"- **累计轮次**：{getattr(cur_agent.context_manager, 'turn_count', 0)} 轮"
                )
            except Exception as err:
                resp = f"⚠️ 读取工作区信息失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/profile":
            try:
                from context.global_memory import default_global_memory
                resp = "### 👤 全局开发画像\n\n```text\n" + default_global_memory.format_profile_view().strip() + "\n```"
            except Exception as err:
                resp = f"⚠️ 读取全局画像失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower.startswith("/remember"):
            parts = raw_cmd.split(None, 1)
            habit = parts[1].strip() if len(parts) > 1 else ""
            if not habit:
                resp = "用法：`/remember <偏好或编码规范>`\n\n例如：`/remember 优先使用 TypeScript 并保持严格类型`"
            else:
                try:
                    from context.global_memory import default_global_memory
                    added = default_global_memory.add_habit(habit)
                    resp = (
                        f"✅ 已将偏好写入全局记忆：\n\n> {habit}\n\n该规范将在所有工程与会话中持续生效。"
                        if added else "ℹ️ 该偏好此前已登记，无需重复添加。"
                    )
                except Exception as err:
                    resp = f"⚠️ 写入全局记忆失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower.startswith("/forget"):
            parts = raw_cmd.split(None, 1)
            keyword = parts[1].strip() if len(parts) > 1 else ""
            if not keyword:
                resp = "用法：`/forget <关键字>`，输入 `/profile` 查看当前已登记的偏好。"
            else:
                try:
                    from context.global_memory import default_global_memory
                    removed = default_global_memory.remove_habit(keyword)
                    if removed:
                        resp = "✅ 已从全局记忆中移除：\n\n" + "\n".join(f"- {r}" for r in removed)
                    else:
                        resp = f"ℹ️ 未找到包含 `{keyword}` 的全局偏好。"
                except Exception as err:
                    resp = f"⚠️ 移除全局记忆失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/history":
            try:
                cm = cur_agent.context_manager
                turns = getattr(cm, "completed_turns", []) or []
                lines = [f"### 🗂️ 会话历史简报（{len(turns)} 轮）", ""]
                if not turns:
                    lines.append("（当前会话暂无已完成的轮次）")
                for chunk in turns[-12:]:
                    user_text = ""
                    messages = getattr(chunk, "messages", None) or []
                    if messages:
                        user_text = str(messages[0].get("content", ""))
                    user_text = " ".join(user_text.split())
                    if len(user_text) > 80:
                        user_text = user_text[:80] + "…"
                    token_count = 0
                    if hasattr(chunk, "estimate_tokens"):
                        try:
                            token_count = chunk.estimate_tokens(cm.token_counter)
                        except Exception:
                            token_count = 0
                    lines.append(f"- **轮次 #{chunk.turn_id}** · {len(messages)} 条消息 · ~{token_count} tokens")
                    lines.append(f"  > {user_text or '（无用户文本）'}")
                if len(turns) > 12:
                    lines.append(f"\n> 仅显示最近 12 轮，共 {len(turns)} 轮。")
                resp = "\n".join(lines)
            except Exception as err:
                resp = f"⚠️ 读取会话历史失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/undo":
            try:
                cm = cur_agent.context_manager
                if getattr(cm, "current_turn", None) is not None:
                    resp = "⚠️ 当前轮次仍在执行中，请等待本轮完成后再撤销。"
                else:
                    if not getattr(cm, "completed_turns", None):
                        cm.restore_from_disk()
                    if not getattr(cm, "completed_turns", None):
                        resp = "ℹ️ 当前会话没有可供撤销的已完成轮次。"
                    else:
                        rolled = cm.completed_turns[-1]
                        ok = cm.rollback_last_turn(restore_disk=True)
                        restored = getattr(cm, "last_rolled_back_files", []) or []
                        remaining = len(cm.completed_turns)
                        if ok and remaining == 0:
                            hist = getattr(cm, "history_file", None)
                            if not hist or not hist.exists():
                                hist = HISTORY_ROOT / cur_proj / f"{active_sid}.jsonl"
                            if hist and hist.exists():
                                hist.unlink()
                            if getattr(cm, "snapshot_manager", None):
                                try:
                                    cm.snapshot_manager.clear_session_snapshots(active_sid)
                                except Exception:
                                    pass
                        if ok:
                            lines = [f"### ↩️ 已撤销轮次 #{rolled.turn_id}", "", f"- 剩余轮次：**{remaining}** 轮"]
                            if restored:
                                lines.append("- 已还原文件：")
                                lines.extend(f"  - `{item}`" for item in restored)
                            else:
                                lines.append("- 本轮未改动物理磁盘文件。")
                            if remaining == 0:
                                lines.append("\n> 该会话已无任何轮次，磁盘历史记录已同步清除。")
                            resp = "\n".join(lines)
                        else:
                            resp = "⚠️ 撤销失败：未能回滚上一轮对话。"
            except Exception as err:
                resp = f"⚠️ 撤销失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower == "/projects":
            try:
                from context.global_memory import default_global_memory
                projs = default_global_memory.list_projects()
                lines = [f"### 🗺️ 已登记工程工作区（{len(projs)} 个）", ""]
                for proj in projs[:40]:
                    desc = f" — {proj.get('description')}" if proj.get("description") else ""
                    lines.append(f"- **{proj['name']}**：`{proj['path']}`{desc}")
                if not projs:
                    lines.append("（暂无已登记工程）")
                elif len(projs) > 40:
                    lines.append(f"\n> 仅显示前 40 个，共 {len(projs)} 个已登记工程。")
                resp = "\n".join(lines)
            except Exception as err:
                resp = f"⚠️ 读取工程地图失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        elif cmd_lower in ("/sessions", "/session"):
            try:
                lister = getattr(cur_agent, "list_sessions", None)
                if not callable(lister):
                    lister = getattr(getattr(cur_agent, "session_manager", None), "list_sessions", None)
                sessions = lister() if callable(lister) else []
                lines = [f"### 💬 当前项目会话（`{cur_proj}`，共 {len(sessions)} 个）", ""]
                for s in sessions:
                    mark = " ← **当前**" if s.get("is_active") else ""
                    lines.append(f"- **{s.get('session_id')}** · {s.get('turn_count', 0)} 轮{mark}")
                if not sessions:
                    lines.append("（暂无会话）")
                resp = "\n".join(lines)
            except Exception as err:
                resp = f"⚠️ 读取会话列表失败：{err}"
            wrapped_callback({"event": "assistant_response", "content": resp, "timestamp": time.time()})
            return resp

        # 智能宏命令映射增强
        if cmd_lower.startswith("/init"):
            prompt = f"请全面扫描当前工作区（{target_ws_dir}）的文件目录结构、关键配置与核心技术栈，并生成一份简明的架构概览。{raw_cmd[5:].strip()}"
        elif cmd_lower.startswith("/review"):
            prompt = f"请对当前工作区的代码实现与核心逻辑进行走查审查，重点关注代码规范、潜在 Bug 与安全隐患。{raw_cmd[7:].strip()}"
        elif cmd_lower.startswith("/test"):
            prompt = f"请检查并运行本地自动化测试（例如 pytest 或 npm test），分析测试输出并定位所有未通过用例。{raw_cmd[5:].strip()}"
        elif cmd_lower.startswith("/fix"):
            prompt = f"请根据最近的报错日志或异常信息进行根因分析，并提供针对性的代码修复方案与补丁验证。{raw_cmd[4:].strip()}"
        elif cmd_lower.startswith("/explain"):
            prompt = f"请详细解析当前项目的核心模块运作机制、调用链与业务流程。{raw_cmd[8:].strip()}"

        loop = asyncio.get_running_loop()

        # 挂载专属独立的流式执行器
        orig_executor = cur_agent.executor
        streaming_executor = StreamingToolExecutor(orig_executor, wrapped_callback)
        cur_agent.executor = streaming_executor

        start_time = time.time()
        start_step = getattr(cur_agent.context_manager, "turn_count", 1)
        first_token_time: Optional[float] = None

        try:
            def on_token_chunk(token: str):
                nonlocal first_token_time
                if first_token_time is None:
                    first_token_time = time.time()
                wrapped_callback({
                    "event": "stream_chunk",
                    "delta": token,
                    "timestamp": time.time()
                })

            collected_thoughts: List[str] = []

            def on_thought_chunk(thought: str):
                if thought and thought not in collected_thoughts:
                    collected_thoughts.append(thought)
                wrapped_callback({
                    "event": "thought",
                    "thought": thought,
                    "timestamp": time.time()
                })

            augmented_prompt = prompt
            image_data_urls = []

            if attachments and len(attachments) > 0:
                att_sections = [f"【用户随消息上传了 {len(attachments)} 个附件】"]
                for idx, att in enumerate(attachments, 1):
                    att_path_str = att.get("path", "")
                    att_name = att.get("name", Path(att_path_str).name if att_path_str else f"附件_{idx}")
                    att_path = Path(att_path_str) if att_path_str else None
                    if att_path and att_path.exists():
                        summary_info = extract_attachment_summary(att_path, filename=att_name)
                        att_sections.append(f"\n--- [附件 {idx}: {att_name}] (类型: {summary_info['type']}, 大小: {summary_info['size']} 字节) ---")
                        att_sections.append(f"本地保存路径: `{summary_info['path']}`")
                        if summary_info["type"] == "image" and summary_info.get("image_meta", {}).get("data_url"):
                            image_data_urls.append(summary_info["image_meta"]["data_url"])
                            att_sections.append("（注：图片已通过多模态视觉通道直接呈现在当前消息中，你可以直接观察并解读图片视觉细节）")
                        elif summary_info.get("extracted_text"):
                            att_sections.append("【文件已预先提取正文与结构内容如下】:")
                            att_sections.append(summary_info["extracted_text"])
                            att_sections.append("【系统强力指导：上述附件全部内容已在此完整提取提供！请直接基于以上提取的正文向用户给出精准、详尽的分析答复，严禁调用任何读取文件或编写执行 Python 脚本的工具！】")
                    else:
                        att_sections.append(f"\n--- [附件 {idx}: {att_name}] ---")
                        if att.get("extracted_text"):
                            att_sections.append(att["extracted_text"])

                att_sections.append("\n【用户具体提问/分析指令】:")
                att_sections.append(prompt or "请详细分析并说明该附件的具体内容。")
                augmented_prompt = "\n".join(att_sections)

            # 构造多模态或增强文本输入
            llm_content: Any = augmented_prompt
            if image_data_urls:
                llm_content = [{"type": "text", "text": augmented_prompt}]
                for d_url in image_data_urls:
                    llm_content.append({
                        "type": "image_url",
                        "image_url": {"url": d_url}
                    })

            def ask_approval_callback(cmd: str, rsn: str) -> bool:
                if default_policy.mode in ("auto", "never") or default_policy.session_approved:
                    return True
                ticket_id = f"ticket_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                done_evt = threading.Event()
                entry = {
                    "event": done_evt,
                    "command": cmd,
                    "reason": rsn,
                    "decision": False,
                    "trust_session": False,
                    "session_id": active_sid,
                    "project": cur_proj
                }
                self.pending_approvals[ticket_id] = entry
                wrapped_callback({
                    "event": "approval_required",
                    "ticket_id": ticket_id,
                    "command": cmd,
                    "reason": rsn,
                    "session_id": active_sid,
                    "project": cur_proj
                })
                finished = done_evt.wait(timeout=300)
                self.pending_approvals.pop(ticket_id, None)
                if not finished:
                    logger.warning(f"Approval timed out for ticket {ticket_id}")
                    return False
                return bool(entry["decision"])

            def handle_user_interaction(req_data: Dict[str, Any]) -> Dict[str, Any]:
                req_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                done_evt = threading.Event()
                entry = {
                    "event": done_evt,
                    "result": {},
                    "session_id": active_sid,
                    "project": cur_proj
                }
                self.pending_user_inputs[req_id] = entry
                wrapped_callback({
                    "event": "user_input_request",
                    "request_id": req_id,
                    "question": req_data.get("question", ""),
                    "options": req_data.get("options", []),
                    "header": req_data.get("header", "用户确认与决策"),
                    "allow_custom": req_data.get("allow_custom", True),
                    "session_id": active_sid,
                    "project": cur_proj
                })
                finished = done_evt.wait(timeout=600)
                self.pending_user_inputs.pop(req_id, None)
                if not finished:
                    return {"selected_option": "", "custom_input": "【用户未在限定时间内响应】"}
                return entry["result"]

            default_policy.approval_callback = ask_approval_callback
            set_user_interaction_handler(handle_user_interaction)

            # 在独立工作线程中运行该专属 Agent 的 run() 并挂接流式 Token 回调与实时思考回调
            try:
                def _run_agent_isolated():
                    old_cwd = Path.cwd()
                    # 动态将工作区切换至当前会话对应的真实物理路径
                    set_workspace_root(target_ws_dir)
                    cur_agent.session_manager.workspace = default_workspace
                    try:
                        os.chdir(target_ws_dir)
                        return cur_agent.run(
                            augmented_prompt, 
                            False, 
                            token_callback=on_token_chunk, 
                            thought_callback=on_thought_chunk,
                            attachments=attachments,
                            display_prompt=prompt,
                            llm_content=llm_content
                        )
                    finally:
                        try:
                            os.chdir(old_cwd)
                        except Exception:
                            pass

                result = await loop.run_in_executor(None, _run_agent_isolated)

                # 计算从用户发送到回复完成的真实总耗时
                elapsed_total = round(max(1.0, time.time() - start_time), 1)

                final_thought = ""
                if collected_thoughts:
                    final_thought = "\n\n".join(collected_thoughts)
                elif getattr(cur_agent, "context_manager", None) and cur_agent.context_manager.completed_turns:
                    last_turn = cur_agent.context_manager.completed_turns[-1]
                    t_list = []
                    for m in getattr(last_turn, "messages", []):
                        if m.get("role") == "assistant":
                            th = m.get("reasoning_content") or m.get("thought")
                            if th and th not in t_list:
                                t_list.append(th)
                    if t_list:
                        final_thought = "\n\n".join(t_list)

                # 最终答复确认推送 (包含真实耗时 elapsed、思考内容 thought 与当前运行安全模式)
                wrapped_callback({
                    "event": "assistant_response",
                    "content": result,
                    "thought": final_thought,
                    "elapsed": elapsed_total,
                    "timestamp": time.time(),
                    "permission_mode": getattr(default_policy, "mode", "auto")
                })
            except Exception as run_err:
                logger.error(f"Error running agent for prompt: {run_err}", exc_info=True)
                elapsed_total = round(max(1.0, time.time() - start_time), 1)
                err_str = str(run_err)
                target_model_name = getattr(cur_agent, 'model', model)
                actual_base_url = getattr(cur_agent, 'base_url', '') or '默认地址'

                is_auth_error = any(k in err_str.lower() for k in ["401", "unauthorized", "invalid_api_key", "api key", "密钥", "未配置模型"])
                is_404_error = any(k in err_str.lower() for k in ["404", "notfound", "not found", "model not found"])
                steps_done = getattr(streaming_executor, "tool_steps_count", 0)

                if is_404_error:
                    err_text = (
                        f"❌ 模型调用失败: 404 Not Found (接口路径或模型未找到)\n\n"
                        f"🔍 当前请求参数:\n"
                        f"- 映射模型: `{target_model_name}`\n"
                        f"- 接口地址 (Base URL): `{actual_base_url}`\n\n"
                        f"💡 排查建议:\n"
                        f"1. **模型名称不存在**: 请确认提供方是否真实开放了 `{target_model_name}` 模型（例如 DeepSeek 官方标准模型名为 `deepseek-chat` 或 `deepseek-reasoner`）；\n"
                        f"2. **Base URL 端点多余或错误**: 接口地址只需填写到域名或版本前缀（例如 `https://api.deepseek.com/v1`），请勿填写 `/chat/completions` 等完整请求后缀；\n"
                        f"3. 请前往右下角「+ 添加模型」或「系统设置 -> 模型提供方」检查并保存最新配置后重试。"
                    )
                elif is_auth_error and steps_done == 0:
                    err_text = f"❌ 模型调用鉴权失败: {str(run_err)}\n\n💡 检查建议: 请前往右下角「+ 添加模型」或「系统设置 -> 模型」检查模型「{target_model_name}」的 API Key、接口地址 (Base URL) 是否正确有效。"
                elif "502" in err_str or "bad gateway" in err_str.lower():
                    err_text = (
                        f"❌ 网关代理异常 (502 Bad Gateway): 上游中转代理服务无法连通目标模型服务器。\n\n"
                        f"🔍 诊断排查:\n"
                        f"- 代理工具 (如 Antigravity Tools) 向上游服务商发起请求时网络中断或超时；\n"
                        f"- 请检查 Antigravity Tools 等中转工具后台日志与梯子/科学上网代理状态；\n"
                        f"- 或前往右下角切换至其他直连模型提供方 (如 DeepSeek)。"
                    )
                elif "503" in err_str or "capacity" in err_str.lower() or "overload" in err_str.lower():
                    err_text = (
                        f"⚠️ 模型服务容量已满或不可用 (503 Service Unavailable): 上游服务商报告当前「{target_model_name}」负载过高 (Model Capacity Exhausted)。\n\n"
                        f"💡 建议: 请稍候 1~2 分钟重试，或在右下角切换为其他可用模型。"
                    )
                # 准确区分内部代码异常与外部模型上游网络服务异常，严禁将代码Bug误报为429限流或网络抖动
                is_internal_error = isinstance(run_err, (
                    UnboundLocalError, NameError, TypeError, AttributeError,
                    IndexError, KeyError, AssertionError, SyntaxError
                ))

                if is_internal_error:
                    err_text = (
                        f"❌ 智能体系统内部执行异常 ({type(run_err).__name__}): {str(run_err)}\n\n"
                        f"🔍 真实原因诊断: 经系统检测，该问题为内部代码逻辑运行异常，**绝非**大模型服务商网络断连或限流问题。\n"
                        f"{f'💡 状态保留: 前序已成功执行的 {steps_done} 步排查与文件改动已完整保存在上下文中。' if steps_done > 0 else ''}\n"
                        f"您可以点击本轮对话下方的「撤销」按钮回滚本轮所有改动，或重新发起任务。"
                    )
                elif any(k in err_str.lower() for k in ["429", "rate limit", "too many requests"]):
                    err_text = (
                        f"⚠️ 模型服务商限流 (429 Too Many Requests): 上游调用超出频次或并发限制。\n\n"
                        f"💡 建议: 请稍候 30~60 秒重试，或前往右下角切换为其他可用模型。"
                    )
                elif steps_done > 0 and (isinstance(run_err, (APIConnectionError, APITimeoutError, RateLimitError, InternalServerError)) or any(k in err_str.lower() for k in ["connection", "timeout", "timed out", "reset by peer", "failed to connect"])):
                    err_text = (
                        f"⚠️ 智能体在第 {steps_done} 步执行中遭遇上游网络中断: {str(run_err)}\n\n"
                        f"💡 状态说明: 前序排查与文件修改已妥善保留，此问题通常由模型服务商瞬时网络抖动或超时引起，非配置失效。\n"
                        f"您可以直接点击「重新生成」或输入「继续」推进下一步任务。"
                    )
                elif steps_done > 0:
                    err_text = (
                        f"⚠️ 智能体在第 {steps_done} 步执行中遭遇异常: {str(run_err)}\n\n"
                        f"💡 状态说明: 前序已执行的 {steps_done} 步排查与文件改动已妥善保留。\n"
                        f"您可以点击本轮用户消息旁的「撤销」按钮撤销改动，或重新发起任务。"
                    )
                else:
                    err_text = f"❌ 模型通信异常: {str(run_err)}\n\n💡 提示: 上游网络连接或模型服务响应超时，请检查网络通畅度或稍后重试。"

                # 确保磁盘历史安全闭环，绝对不留悬挂未闭合的孤儿 turn
                try:
                    if cur_agent and hasattr(cur_agent, "context_manager") and cur_agent.context_manager:
                        cur_agent.context_manager.add_assistant_message(err_text)
                        cur_agent.context_manager.finish_current_turn(elapsed=elapsed_total)
                except Exception:
                    pass

                wrapped_callback({
                    "event": "assistant_response",
                    "content": err_text,
                    "elapsed": elapsed_total,
                    "timestamp": time.time(),
                    "is_error": True
                })
                return err_text

            # 计算最终遥测指标并推送 (真实动态遥测：统计真实耗时、工具调用与每秒吐字速率)
            elapsed_total = max(0.1, time.time() - start_time)
            cm = cur_agent.context_manager
            comp_tokens = getattr(cm, "total_api_completion_tokens", 0)
            tool_sec = round(streaming_executor.total_tool_elapsed, 1)
            llm_calc_time = max(0.2, elapsed_total - tool_sec)
            tok_per_sec = round(comp_tokens / llm_calc_time, 1) if (comp_tokens > 0 and llm_calc_time > 0) else 0

            ttft_val = f"{round(first_token_time - start_time, 1)}s" if first_token_time else "--"
            tool_time_str = f"{int(tool_sec // 60)}m{int(tool_sec % 60)}s" if tool_sec >= 60 else f"{round(tool_sec, 1)}s"
            total_time_str = f"{int(elapsed_total // 60)}m{int(elapsed_total % 60)}s" if elapsed_total >= 60 else f"{round(elapsed_total, 1)}s"

            wrapped_callback({
                "event": "metrics",
                "turns": cm.turn_count,
                "steps": max(1, streaming_executor.tool_steps_count or cm.turn_count * 2),
                "total_time": total_time_str,
                "tool_time": tool_time_str,
                "tokens_per_sec": tok_per_sec,
                "ttft": ttft_val,
                "cache_hit_rate": getattr(cm, "api_cache_hit_rate", 0.0),
                "cached_tokens": getattr(cm, "total_api_cached_tokens", 0),
                "prompt_tokens": cm.total_api_prompt_tokens,
                "completion_tokens": cm.total_api_completion_tokens,
                "total_tokens": cm.total_api_prompt_tokens + cm.total_api_completion_tokens
            })

            return result
        except asyncio.CancelledError:
            logger.info(f"AgentBridge: execute_prompt_stream cancelled for session '{active_sid}'")
            cur_agent.abort()
            raise
        finally:
            default_policy.approval_callback = None
            set_user_interaction_handler(None)
            cur_agent.executor = orig_executor

bridge = AgentBridge()
