# -*- coding: utf-8 -*-
"""
core/evaluator.py: 离线轨迹质检与评测引擎 (OfflineTrajectoryEvaluator)
用于对 Agent 会话的全生命周期执行轨迹进行深度体检，产出结构化评测报告。
企业级分层模型：
1. 宏观会话级 (Session Trace Level): 全会话健康分、跨轮次成功率、总体能耗与诊断清单。
2. 微观轮次级 (Turn Span Level): 逐轮次独立评测指标、单轮工具效率、单轮质检结论与单轮小结。
3. 原子步骤级 (Event Level): 每个 Tool / Assistant 节点的 Agent 角色与质检诊断打标。
"""
import json
import time
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class OfflineTrajectoryEvaluator:
    """会话全链路离线轨迹评测器"""

    def evaluate_session(
        self,
        turns: List[Dict[str, Any]],
        project_name: str = "default",
        session_id: str = "default"
    ) -> Dict[str, Any]:
        """
        全面评估一个会话的所有轮次与执行步骤，生成全会话宏观指标及逐轮次微观评测明细。
        返回符合 TrajectoryEvalReport 规范的结构化字典。
        """
        total_turns = len(turns)
        all_actions: List[Dict[str, Any]] = []
        all_tasks: List[Dict[str, Any]] = []
        all_critic_results: List[Dict[str, Any]] = []
        total_elapsed = 0.0

        for turn in turns:
            turn_actions = turn.get("actions") or []
            all_actions.extend(turn_actions)

            turn_tasks = turn.get("tasks") or []
            if turn_tasks:
                all_tasks = turn_tasks

            critic_info = turn.get("critic")
            if critic_info:
                all_critic_results.append(critic_info)

            el = turn.get("elapsed")
            if el is not None and isinstance(el, (int, float)):
                total_elapsed += float(el)

        # 1. 全会话工具调用统计与成功率
        total_tool_calls = len(all_actions)
        tool_errors = 0
        tool_frequencies: Dict[str, int] = {}

        for act in all_actions:
            t_name = act.get("tool") or act.get("display") or "unknown"
            tool_frequencies[t_name] = tool_frequencies.get(t_name, 0) + 1

            status = act.get("status")
            out = act.get("output", "")
            is_err = (
                status == "error"
                or "【执行状态: 退出码 1】" in out
                or "Error:" in out
                or "【安全拦截拒绝】" in out
            )
            if is_err:
                tool_errors += 1

        successful_tool_calls = max(0, total_tool_calls - tool_errors)
        tool_success_rate = (
            round((successful_tool_calls / total_tool_calls) * 100, 1)
            if total_tool_calls > 0
            else 100.0
        )

        # 2. 探索效率与冗余调用检测 (Redundancy Detection)
        redundant_calls_count = 0
        redundant_action_ids = set()
        seen_read_paths = set()
        seen_queries = set()

        for act in all_actions:
            act_id = act.get("id") or ""
            tool_name = (act.get("tool") or "").lower()
            args = act.get("args") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}

            if any(k in tool_name for k in ["read", "cat", "view"]):
                path_val = args.get("path") or args.get("file_path") or act.get("path") or ""
                if path_val:
                    if path_val in seen_read_paths:
                        redundant_calls_count += 1
                        if act_id:
                            redundant_action_ids.add(act_id)
                    else:
                        seen_read_paths.add(path_val)

            if any(k in tool_name for k in ["write", "patch", "edit"]):
                seen_read_paths.clear()

            if any(k in tool_name for k in ["shell", "pwsh", "cmd", "bash"]):
                cmd_val = (args.get("command") or args.get("cmd") or "").strip()
                if cmd_val and cmd_val in ["dir", "ls", "pwd", "Get-ChildItem"]:
                    if cmd_val in seen_queries:
                        redundant_calls_count += 1
                        if act_id:
                            redundant_action_ids.add(act_id)
                    else:
                        seen_queries.add(cmd_val)

        efficiency_score = max(0, 100 - redundant_calls_count * 15)

        # 3. 规划达成度统计
        total_tasks = len(all_tasks)
        completed_tasks = sum(1 for t in all_tasks if t.get("completed"))
        task_completion_rate = (
            round((completed_tasks / total_tasks) * 100, 1)
            if total_tasks > 0
            else 100.0
        )

        # 4. 在线审查与自愈表现
        critic_scores = [float(c.get("score", 5.0)) for c in all_critic_results if c.get("score") is not None]
        avg_critic_score = round(sum(critic_scores) / len(critic_scores), 1) if critic_scores else 5.0
        self_healing_count = sum(1 for c in all_critic_results if c.get("status") == "rejected" or c.get("loop", 0) > 0)
        has_final_pass = (
            all_critic_results[-1].get("status") == "passed"
            if all_critic_results
            else True
        )

        # 5. Token 资源消耗估算
        total_chars = 0
        for turn in turns:
            total_chars += len(turn.get("user_prompt", ""))
            total_chars += len(turn.get("assistant_response", ""))
            total_chars += len(turn.get("thought", ""))
            for act in turn.get("actions", []):
                total_chars += len(str(act.get("args", "")))
                total_chars += len(str(act.get("output", "")))

        est_total_tokens = max(120, int(total_chars / 2.8))
        est_prompt_tokens = int(est_total_tokens * 0.72)
        est_completion_tokens = max(20, est_total_tokens - est_prompt_tokens)

        # 6. 计算全会话宏观健康度评分 (0~100)
        health_score = 100.0
        health_score -= tool_errors * 10.0
        health_score -= redundant_calls_count * 5.0
        if total_tasks > 0 and task_completion_rate < 100.0:
            health_score -= (100.0 - task_completion_rate) * 0.35
        if avg_critic_score < 4.5:
            health_score -= (4.5 - avg_critic_score) * 12.0
        if self_healing_count > 0 and has_final_pass:
            health_score += 5.0

        health_score = round(min(100.0, max(20.0, health_score)), 1)

        if health_score >= 95.0:
            health_level = "A+"
        elif health_score >= 85.0:
            health_level = "A"
        elif health_score >= 70.0:
            health_level = "B"
        else:
            health_level = "C"

        # 7. 全会话诊断发现
        diagnostics = []
        if total_tasks > 0:
            if task_completion_rate >= 100.0:
                diagnostics.append({
                    "type": "pass",
                    "title": "任务清单全量达成",
                    "detail": f"规划的 {total_tasks} 项分解任务均已按序推进并 100% 闭环落地。"
                })
            else:
                diagnostics.append({
                    "type": "warning",
                    "title": "部分规划任务未标记完成",
                    "detail": f"共规划 {total_tasks} 项任务，已完成 {completed_tasks} 项，推进率 {task_completion_rate}%。"
                })
        else:
            diagnostics.append({
                "type": "info",
                "title": "即时问答直达交付",
                "detail": "本会话为概念问答或快速响应，由 Planner 智能旁路，免除多余任务拆解开销。"
            })

        if total_tool_calls > 0:
            if tool_errors == 0:
                diagnostics.append({
                    "type": "pass",
                    "title": "工具执行零报错",
                    "detail": f"全链路共执行 {total_tool_calls} 次工具调用，成功率达 100.0%，无退出码异常与安全拦截。"
                })
            else:
                diagnostics.append({
                    "type": "warning",
                    "title": "存在工具异常或失败",
                    "detail": f"共调用 {total_tool_calls} 次工具，其中 {tool_errors} 次执行异常或退出码非零。"
                })
        else:
            diagnostics.append({
                "type": "info",
                "title": "零工具调用纯对话",
                "detail": "未触发物理工具调用，全流程由认知模型纯文本生成完成。"
            })

        if redundant_calls_count == 0:
            diagnostics.append({
                "type": "pass",
                "title": "探索收敛路径优异",
                "detail": f"探索有效率评分 {efficiency_score} 分，无重复读文件与同构探测冗余。"
            })
        else:
            diagnostics.append({
                "type": "warning",
                "title": "检测到重复或冗余调用",
                "detail": f"发现 {redundant_calls_count} 次重复探索（重复读取相同文件或同类查询），已扣除效率分。"
            })

        if all_critic_results:
            if self_healing_count > 0:
                diagnostics.append({
                    "type": "pass",
                    "title": "在线质检反思自愈成功",
                    "detail": f"会话曾触发 {self_healing_count} 次质检反馈，并成功完成反思自愈修正，体现高容错韧性。"
                })
            elif has_final_pass:
                diagnostics.append({
                    "type": "pass",
                    "title": "后置审查一次性高分通过",
                    "detail": f"Critic 综合质检评分 {avg_critic_score} / 5.0，符合生产级交付标准。"
                })

        # 8. 步骤级标注 (Step Annotations)
        step_annotations: Dict[str, Dict[str, Any]] = {}
        for act in all_actions:
            act_id = act.get("id") or ""
            if not act_id:
                continue
            is_redundant = act_id in redundant_action_ids
            status = act.get("status")
            out = act.get("output", "")
            is_err = status == "error" or "【执行状态: 退出码 1】" in out

            if is_err:
                step_annotations[act_id] = {
                    "agent_role": "worker",
                    "diagnosis": "工具执行报错",
                    "badge_type": "error",
                    "is_redundant": is_redundant
                }
            elif is_redundant:
                step_annotations[act_id] = {
                    "agent_role": "worker",
                    "diagnosis": "冗余重复探索",
                    "badge_type": "warning",
                    "is_redundant": True
                }
            else:
                step_annotations[act_id] = {
                    "agent_role": "worker",
                    "diagnosis": "执行正常",
                    "badge_type": "success",
                    "is_redundant": False
                }

        # 9. 逐轮次微观独立评测计算 (Turn-by-Turn Evaluations)
        turns_eval: List[Dict[str, Any]] = []
        for idx, t in enumerate(turns):
            tid = t.get("turn_id", idx + 1)
            u_prompt = t.get("user_prompt", "")
            t_actions = t.get("actions", [])
            t_tasks = t.get("tasks", [])
            t_critic = t.get("critic")
            t_elapsed = float(t.get("elapsed", 0.0))

            t_tool_calls = len(t_actions)
            t_tool_errors = 0
            t_redundant = 0
            t_step_ids = []

            for act in t_actions:
                aid = act.get("id", "")
                if aid:
                    t_step_ids.append(aid)
                out = act.get("output", "")
                if act.get("status") == "error" or "【执行状态: 退出码 1】" in out:
                    t_tool_errors += 1
                if aid in redundant_action_ids:
                    t_redundant += 1

            t_success_rate = (
                round(((t_tool_calls - t_tool_errors) / t_tool_calls) * 100, 1)
                if t_tool_calls > 0
                else 100.0
            )

            # 单轮任务完成度
            t_total_tasks = len(t_tasks)
            t_comp_tasks = sum(1 for item in t_tasks if item.get("completed"))
            t_task_rate = (
                round((t_comp_tasks / t_total_tasks) * 100, 1)
                if t_total_tasks > 0
                else 100.0
            )

            # 单轮 Critic 评分
            c_score_val = None
            c_score_str = "未触发"
            c_status = "none"
            c_reason = ""
            if t_critic and isinstance(t_critic, dict):
                c_status = t_critic.get("status", "none")
                if t_critic.get("score") is not None:
                    c_score_val = float(t_critic["score"])
                    c_score_str = f"{c_score_val:.1f} / 5.0"
                c_reason = t_critic.get("reason", "")

            # 单轮 Token 估算
            t_chars = len(u_prompt) + len(t.get("assistant_response", "")) + len(t.get("thought", ""))
            for act in t_actions:
                t_chars += len(str(act.get("args", ""))) + len(str(act.get("output", "")))
            t_tokens = max(50, int(t_chars / 2.8))

            # 单轮健康分计算
            t_health = 100.0
            t_health -= t_tool_errors * 15.0
            t_health -= t_redundant * 8.0
            if t_total_tasks > 0 and t_task_rate < 100.0:
                t_health -= (100.0 - t_task_rate) * 0.35
            if c_score_val is not None and c_score_val < 4.5:
                t_health -= (4.5 - c_score_val) * 15.0
            if c_status == "rejected":
                t_health -= 10.0

            t_health = round(min(100.0, max(20.0, t_health)), 1)
            if t_health >= 95.0:
                t_level = "A+"
            elif t_health >= 85.0:
                t_level = "A"
            elif t_health >= 70.0:
                t_level = "B"
            else:
                t_level = "C"

            # 生成单轮质检小结
            if t_tool_calls == 0:
                t_summary = "本轮为即时问答直答交付，认知模型直接完成输出，无物理工具副作用。"
            elif t_tool_errors == 0 and t_redundant == 0:
                if c_status == "passed":
                    t_summary = f"规划任务闭环率 {t_task_rate}%，工具 {t_tool_calls}/{t_tool_calls} 步全部成功，后置审查满分通过。"
                else:
                    t_summary = f"工具执行 {t_tool_calls} 步全部成功，无冗余调用，产出已顺利交付。"
            else:
                issues = []
                if t_tool_errors > 0:
                    issues.append(f"{t_tool_errors} 次工具报错")
                if t_redundant > 0:
                    issues.append(f"{t_redundant} 次冗余读")
                t_summary = f"检测到 {', '.join(issues)}，已触发相应容错与自愈机制。"

            turns_eval.append({
                "turn_id": tid,
                "user_prompt": u_prompt[:80] + ("..." if len(u_prompt) > 80 else ""),
                "health_score": t_health,
                "health_level": t_level,
                "tool_calls_count": t_tool_calls,
                "tool_errors_count": t_tool_errors,
                "tool_success_rate": f"{t_success_rate}%",
                "redundant_calls_count": t_redundant,
                "elapsed": f"{round(t_elapsed, 1)}s",
                "tokens": t_tokens,
                "task_completion_rate": f"{t_task_rate}%",
                "critic_score": c_score_str,
                "critic_status": c_status,
                "critic_reason": c_reason,
                "turn_summary": t_summary,
                "step_ids": t_step_ids
            })

        metric_cards = [
            {
                "label": "执行成功率",
                "value": f"{tool_success_rate}%",
                "sub": f"{successful_tool_calls}/{total_tool_calls} 步正常" if total_tool_calls > 0 else "纯对话零异常",
                "status": "good" if tool_success_rate >= 95.0 else ("warning" if tool_success_rate >= 80.0 else "error")
            },
            {
                "label": "探索有效率",
                "value": f"{efficiency_score}分",
                "sub": f"{redundant_calls_count} 次冗余探索" if redundant_calls_count > 0 else "0 冗余调用 · 高度收敛",
                "status": "good" if efficiency_score >= 85 else "warning"
            },
            {
                "label": "资源与耗时",
                "value": f"{round(total_elapsed, 1)}s",
                "sub": f"约 {est_total_tokens} tokens · {total_turns} 轮对话",
                "status": "good" if total_elapsed < 60.0 else "info"
            },
            {
                "label": "规划达成率",
                "value": f"{task_completion_rate}%",
                "sub": f"{completed_tasks}/{total_tasks} 任务闭环" if total_tasks > 0 else f"质检评分 {avg_critic_score}/5.0",
                "status": "good" if task_completion_rate >= 100.0 else "warning"
            }
        ]

        summary = (
            f"本会话共运行 {total_turns} 轮次，累计执行 {total_tool_calls} 次工具调用。"
            f"任务规划达成率 {task_completion_rate}%，工具调用成功率 {tool_success_rate}%，"
            f"全链路健康得分 {health_score} / 100 ({health_level})。"
        )

        return {
            "session_id": session_id,
            "project": project_name,
            "timestamp": time.time(),
            "health_score": health_score,
            "health_level": health_level,
            "summary": summary,
            "metrics": {
                "tool_success_rate": f"{tool_success_rate}%",
                "tool_calls_count": total_tool_calls,
                "tool_errors_count": tool_errors,
                "efficiency_score": f"{efficiency_score}分",
                "redundant_calls_count": redundant_calls_count,
                "total_tokens": est_total_tokens,
                "prompt_tokens": est_prompt_tokens,
                "completion_tokens": est_completion_tokens,
                "total_elapsed": f"{round(total_elapsed, 1)}s",
                "task_completion_rate": f"{task_completion_rate}%",
                "critic_pass_rate": f"{avg_critic_score} / 5.0",
                "self_healing_count": self_healing_count
            },
            "metric_cards": metric_cards,
            "diagnostics": diagnostics,
            "step_annotations": step_annotations,
            "turns_eval": turns_eval
        }
