# -*- coding: utf-8 -*-
"""
core/planner.py: 任务拆解与意图路由智能体 (TaskPlanner)
在主 ReAct 智能体执行前，对用户复杂 Prompt 进行意图分析与 DAG/Checklist 结构化拆解。
具备轻量级快速旁路 (Fast Bypass)、容错 JSON 抽取和结构化任务输出。
"""
import re
import json
import logging
from typing import List, Dict, Any, Optional, Callable
from openai import OpenAI

logger = logging.getLogger(__name__)

PLANNER_SYSTEM_PROMPT = """你是一个专业的软件工程任务拆解与意图规划智能体 (Task Planner)。
你的任务是分析用户的需求/提示词，判断是否需要拆解为多步有序的工程任务。

【决策规则】
1. 简单意图 (Fast Bypass)：
   - 若用户仅是日常打招呼、闲聊、概念解释、简单提问或单一文件只读查阅（例如"你好"、"什么是AST"、"看下README"）；
   - 请直接返回空列表 []，无需进行过度拆解。

2. 复杂工程意图 (Task Decomposition)：
   - 若任务涉及代码修改、Bug修复、功能新增、页面生成、脚本编写、重构、测试编写与验证、架构分析等多步流程；
   - 请将目标拆解为 2 到 4 个清晰、具体、可被执行与验收的原子任务步骤（自上而下按序推进）。
   - 每个任务需包含精炼标题（15字以内），并指明具体目标（如定位排查、编写代码、运行测试等）。

【输出格式要求】
必须严格输出纯 JSON 数组，严禁包含任何前缀解释、Markdown 代码块标记（如 ```json）或多余字符。
示例（复杂任务）：
[
  {"id": "task_1", "title": "定位目标模块并排查核心调用逻辑", "completed": false},
  {"id": "task_2", "title": "修改代码实现并应用补丁", "completed": false},
  {"id": "task_3", "title": "运行自动化测试验证功能闭环", "completed": false}
]
示例（简单任务）：
[]
"""

def extract_tasks_json(text: str) -> List[Dict[str, Any]]:
    """从大模型原始返回中容错提取任务 JSON 列表"""
    if not text:
        return []
    clean = text.strip()

    # 1. 直接尝试反序列化
    try:
        data = json.loads(clean)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "tasks" in data and isinstance(data["tasks"], list):
            return data["tasks"]
    except Exception:
        pass

    # 2. 匹配 Markdown 代码块 ```json ... ```
    match = re.search(r"```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```", clean, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                return data
        except Exception:
            pass

    # 3. 寻找最外层中括号 [ ... ]
    start = clean.find("[")
    end = clean.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(clean[start:end+1].strip())
            if isinstance(data, list):
                return data
        except Exception:
            pass

    return []


class TaskPlanner:
    def __init__(self, client: Optional[OpenAI] = None, model: Optional[str] = None):
        self.client = client
        self.model = model

    def plan_tasks(
        self, 
        user_prompt: str, 
        context: Optional[str] = None,
        status_callback: Optional[Callable[[str], None]] = None
    ) -> List[Dict[str, Any]]:
        """
        对用户提示词进行意图解析与任务拆解。
        若无需拆解返回空列表 []；若需拆解返回 TaskItem 列表。
        """
        if not user_prompt or not self.client or not self.model:
            return []

        trimmed = user_prompt.strip().lower()
        # 1. 快速启发式过滤：简单问候、闲聊、礼貌用语直接旁路，预判无需调用工具
        quick_greetings = [
            "你好", "hello", "hi", "嗨", "在吗", "你是谁", "介绍一下自己",
            "早上好", "中午好", "下午好", "晚上好", "谢谢", "再见", "help", "/help", "ping"
        ]
        if any(trimmed == g or trimmed.startswith(g) for g in quick_greetings) and len(trimmed) < 30:
            return []

        # 2. 概念型/解释型纯问答（问询原理、概念、原因，且不包含强制执行/操作指令），预判无需调用工具操作代码或文件
        concept_starters = ["什么是", "解释一下", "为什么", "如何理解", "区别是什么", "介绍一下", "能否讲解"]
        is_asking_concept = any(trimmed.startswith(q) for q in concept_starters)
        has_direct_action_command = any(k in trimmed for k in ["帮我", "请帮", "对项目", "针对当前", "修改代码", "编写代码", "创建文件", "生成文件", "落地"])

        if is_asking_concept and not has_direct_action_command and len(trimmed) < 60:
            return []

        if status_callback:
            status_callback("正在分析意图并规划任务清单...")

        valid_tasks: List[Dict[str, Any]] = []

        try:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                    {"role": "user", "content": f"用户提示词：\n{user_prompt}"}
                ],
                temperature=0.1,
                max_tokens=1000
            )
            msg = resp.choices[0].message
            raw_content = getattr(msg, "content", "") or ""
            # 若模型输出在 reasoning_content 中，兜底提取
            if not raw_content and hasattr(msg, "reasoning_content"):
                raw_content = getattr(msg, "reasoning_content", "") or ""

            raw_tasks = extract_tasks_json(raw_content)
            for idx, item in enumerate(raw_tasks, 1):
                if isinstance(item, dict) and "title" in item:
                    t_id = item.get("id") or f"task_{idx}"
                    valid_tasks.append({
                        "id": str(t_id),
                        "title": str(item["title"]),
                        "completed": False
                    })
        except Exception as e:
            logger.warning(f"TaskPlanner 模型调用异常: {e}")

        # 智能兜底：若模型解析为空，但用户明确输入了典型的多步工程生成/修改指令，避免出现“没有任务清单”的冷场情况
        is_explicit_task = any(kw in trimmed for kw in [
            "生成", "创建", "修改", "修复", "实现", "开发", "编写", "重构", 
            "优化", "测试", "排查", "分析", "写一个", "做个", "html", "网页"
        ]) and len(trimmed) >= 8

        if not valid_tasks and is_explicit_task:
            valid_tasks = [
                {"id": "task_1", "title": "分析工程上下文与目标结构", "completed": False},
                {"id": "task_2", "title": "执行核心代码实现与文件落地", "completed": False},
                {"id": "task_3", "title": "验证执行成果与质量审查", "completed": False}
            ]

        if status_callback and valid_tasks:
            status_callback(f"任务规划清单已就绪（共 {len(valid_tasks)} 项任务），准备执行...")

        return valid_tasks
