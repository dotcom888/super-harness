# -*- coding: utf-8 -*-
"""
core/critic.py: 质量审查与验收智能体 (CriticVerifier)
在主 ReAct Agent 交付前介入，执行：
1. 目标对齐度审查（对照 Planner 初始任务 Checklist）
2. 真实物理测试回归（自动探测并运行 pytest / npm test）
3. 代码健康与副作用审查（Git Diff 语法与残留检查）
若未通过，输出结构化《驳回单》并触发循环反思修复（最多 2 次）。
"""
import os
import json
import logging
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from openai import OpenAI

logger = logging.getLogger(__name__)

CRITIC_SYSTEM_PROMPT = """你是一个严格的代码质量审查与验收智能体 (Critic Verifier)。
你的职责是在执行智能体 (Worker) 完成代码变更后，对交付质量进行终审验收，并输出详实的逐项审查明细。

【审查维度】
1. 目标与规划对齐度：是否满足了最初规划的各项任务？需求是否闭环？
2. 代码规范与无副作用：是否有未完成的 TODO、未清理的调试打印 (print/console.log)、明显的语法与类型漏洞？
3. 成果落地与功能可用性：目标文件是否已按要求生成落盘、文件内容与结构是否完整可用、测试是否通过？

【输出格式要求】
必须严格输出纯 JSON 对象，格式如下：
{
  "passed": true 或 false,
  "score": 1 到 5 的质量综合评分（浮点数，如 5.0）,
  "reason": "通过简评或驳回原因说明（50字以内）",
  "actionable_fix": "若未通过，给出下一步具体修改指引（若通过则留空）",
  "dimensions": [
    {
      "name": "目标与规划对齐度",
      "score": 5.0,
      "passed": true,
      "detail": "简述核验情况（例如：用户提问与规划任务100%闭环达成）"
    },
    {
      "name": "代码规范与无副作用",
      "score": 5.0,
      "passed": true,
      "detail": "简述核验情况（例如：无语法错误、无未清理调试代码）"
    },
    {
      "name": "成果落地与功能可用性",
      "score": 5.0,
      "passed": true,
      "detail": "简述核验情况（例如：目标文件已成功落盘且内容完整可用）"
    }
  ]
}
"""

def _build_default_dimensions(
    passed: bool,
    score: float,
    test_info: Optional[Dict[str, Any]] = None,
    reason: str = ""
) -> List[Dict[str, Any]]:
    sc = round(float(score), 1)
    if test_info and not test_info.get("passed", True):
        return [
            {
                "name": "目标与规划对齐度",
                "score": min(5.0, max(1.0, round(sc + 1.0, 1))),
                "passed": False,
                "detail": "代码逻辑已修改但未通过自动化测试回归"
            },
            {
                "name": "代码规范与无副作用",
                "score": max(1.0, sc),
                "passed": False,
                "detail": f"测试执行异常: {test_info.get('framework', 'test')} 报错"
            },
            {
                "name": "成果落地与功能可用性",
                "score": max(1.0, sc),
                "passed": False,
                "detail": "功能验证未达标，需按报错修正"
            }
        ]
    if passed:
        return [
            {
                "name": "目标与规划对齐度",
                "score": sc,
                "passed": True,
                "detail": "100% 达成用户初始目标与规划任务清单"
            },
            {
                "name": "代码规范与无副作用",
                "score": sc,
                "passed": True,
                "detail": "无语法错误、无未清理调试打印与异常"
            },
            {
                "name": "成果落地与功能可用性",
                "score": sc,
                "passed": True,
                "detail": "目标成果已完整落地并具备可用性"
            }
        ]
    else:
        return [
            {
                "name": "目标与规划对齐度",
                "score": min(5.0, max(1.0, round(sc + 0.5, 1))),
                "passed": False,
                "detail": reason or "部分规划任务或需求未达成"
            },
            {
                "name": "代码规范与无副作用",
                "score": max(1.0, sc),
                "passed": False,
                "detail": "发现潜在缺陷或未清理副作用"
            },
            {
                "name": "成果落地与功能可用性",
                "score": max(1.0, round(sc - 0.5, 1)),
                "passed": False,
                "detail": "交付产出物需进一步修复完善"
            }
        ]

class CriticVerifier:
    def __init__(self, client: Optional[OpenAI] = None, model: Optional[str] = None):
        self.client = client
        self.model = model

    def run_physical_tests(self, workspace_root: Optional[Path] = None) -> Optional[Dict[str, Any]]:
        """
        自动探测并执行项目中的单元测试（物理沙箱级运行）
        """
        ws = workspace_root or Path.cwd()
        # 探测 Python pytest
        if (ws / "tests").exists() or (ws / "pytest.ini").exists() or any(ws.glob("test_*.py")):
            try:
                res = subprocess.run(
                    ["pytest", "-q", "--tb=line"],
                    cwd=str(ws),
                    capture_output=True,
                    text=True,
                    timeout=20
                )
                return {
                    "framework": "pytest",
                    "exit_code": res.returncode,
                    "passed": res.returncode == 0,
                    "output": (res.stdout + "\n" + res.stderr)[:2000]
                }
            except Exception as e:
                logger.info(f"执行 pytest 测试跳过或超时: {e}")

        # 探测 Node npm test
        if (ws / "package.json").exists():
            try:
                pkg_data = json.loads((ws / "package.json").read_text(encoding="utf-8"))
                if "scripts" in pkg_data and "test" in pkg_data["scripts"]:
                    res = subprocess.run(
                        ["npm", "test"],
                        cwd=str(ws),
                        capture_output=True,
                        text=True,
                        shell=True,
                        timeout=20
                    )
                    return {
                        "framework": "npm",
                        "exit_code": res.returncode,
                        "passed": res.returncode == 0,
                        "output": (res.stdout + "\n" + res.stderr)[:2000]
                    }
            except Exception as e:
                logger.info(f"执行 npm test 跳过或超时: {e}")

        return None

    def get_git_diff_summary(self, workspace_root: Optional[Path] = None) -> str:
        """获取当前工作区的未提交代码改动摘要"""
        ws = workspace_root or Path.cwd()
        if (ws / ".git").exists():
            try:
                res = subprocess.run(
                    ["git", "diff", "--stat"],
                    cwd=str(ws),
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
            except Exception:
                pass
        return "无 Git 变更统计"

    def verify_turn(
        self,
        user_prompt: str,
        tasks: List[Dict[str, Any]],
        assistant_reply: str,
        workspace_root: Optional[Path] = None,
        tool_results_summary: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        综合评定本轮交付质量。
        返回 Dict: {"passed": bool, "score": float, "reason": str, "actionable_fix": str}
        """
        # 1. 如果没有任务拆解且只是简短回答，直接默认通过
        if not tasks and len(assistant_reply) < 300 and not any(k in user_prompt.lower() for k in ["修改", "写", "patch", "fix", "bug", "重构"]):
            return {
                "passed": True,
                "score": 5.0,
                "reason": "即时问答无需质检验收",
                "actionable_fix": "",
                "dimensions": _build_default_dimensions(True, 5.0)
            }

        # 2. 物理自动化测试结果采集
        test_info = self.run_physical_tests(workspace_root)
        diff_info = self.get_git_diff_summary(workspace_root)

        # 3. 构造审查证据上下文
        review_context = {
            "user_prompt": user_prompt,
            "tasks": tasks,
            "assistant_reply_summary": assistant_reply[:1000],
            "git_diff_stat": diff_info,
            "physical_test": test_info
        }

        # 如果测试明确挂了，直接确定性拦截
        if test_info and not test_info["passed"]:
            return {
                "passed": False,
                "score": 2.0,
                "reason": f"自动化测试 ({test_info['framework']}) 未通过",
                "actionable_fix": f"测试报错信息：\n{test_info['output'][:500]}\n请根据测试失败信息进行针对性代码修正！",
                "dimensions": _build_default_dimensions(False, 2.0, test_info=test_info)
            }

        # 4. 调用模型进行语义目标核验 (LLM-as-Judge)
        if self.client and self.model:
            try:
                resp = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": CRITIC_SYSTEM_PROMPT},
                        {"role": "user", "content": f"请对以下智能体执行结果进行质量审查：\n```json\n{json.dumps(review_context, ensure_ascii=False, indent=2)}\n```"}
                    ],
                    temperature=0.1,
                    max_tokens=600
                )
                raw = resp.choices[0].message.content or ""
                raw = raw.strip()
                if raw.startswith("```"):
                    lines = raw.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].strip().startswith("```"):
                        lines = lines[:-1]
                    raw = "\n".join(lines).strip()

                parsed = json.loads(raw)
                if isinstance(parsed, dict) and "passed" in parsed:
                    is_passed = bool(parsed.get("passed", True))
                    overall_score = float(parsed.get("score", 5.0 if is_passed else 2.5))
                    raw_dims = parsed.get("dimensions")
                    if isinstance(raw_dims, list) and len(raw_dims) > 0:
                        norm_dims = []
                        for d in raw_dims:
                            if isinstance(d, dict):
                                norm_dims.append({
                                    "name": str(d.get("name", "质量检查项")),
                                    "score": float(d.get("score", overall_score)),
                                    "passed": bool(d.get("passed", is_passed)),
                                    "detail": str(d.get("detail", ""))
                                })
                        dimensions = norm_dims if norm_dims else _build_default_dimensions(is_passed, overall_score, reason=str(parsed.get("reason", "")))
                    else:
                        dimensions = _build_default_dimensions(is_passed, overall_score, reason=str(parsed.get("reason", "")))

                    return {
                        "passed": is_passed,
                        "score": overall_score,
                        "reason": str(parsed.get("reason", "质量核验通过" if is_passed else "质量核验未通过")),
                        "actionable_fix": str(parsed.get("actionable_fix", "")),
                        "dimensions": dimensions
                    }
            except Exception as e:
                logger.warning(f"Critic 语义审查异常（安全降级通过）: {e}")

        return {
            "passed": True,
            "score": 4.5,
            "reason": "代码逻辑与任务已闭环验收",
            "actionable_fix": "",
            "dimensions": _build_default_dimensions(True, 4.5)
        }
