# -*- coding: utf-8 -*-
"""
tests/test_multi_agent.py: 多智能体协同流水线单元测试
覆盖：
1. TaskPlanner 意图识别与快速旁路 (问候、纯问答零多余拆解)
2. TaskPlanner 复杂工程任务拆解与容错提取
3. CriticVerifier 自动化物理测试与语义验收
4. ReActAgent 纯对话零工具调用时不触发 Critic (工具调用依赖原则)
5. ReActAgent 调用工具时触发 Critic 验收闭环
6. 任务清单严格单调推进测试 (杜绝任务跳跃打钩，如第一项与第三项完成但第二项未完成的 Bug)
"""
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

from core.planner import TaskPlanner
from core.critic import CriticVerifier
from core.agent import ReActAgent
from context import ContextManager, BudgetLedger


class TestMultiAgentPipeline(unittest.TestCase):
    def setUp(self):
        self.mock_client = MagicMock()
        self.model = "test-model"

    def test_task_planner_fast_bypass(self):
        """测试 TaskPlanner 对简单打招呼与概念性纯问答的快速旁路，预判无需调用工具"""
        planner = TaskPlanner(client=self.mock_client, model=self.model)
        for prompt in ["你好", "你好呀", "hello", "你是谁", "介绍一下自己", "什么是抽象语法树AST？", "为什么需要重构？"]:
            tasks = planner.plan_tasks(prompt)
            self.assertEqual(tasks, [], f"Prompt '{prompt}' should be bypassed")
        self.mock_client.chat.completions.create.assert_not_called()

    def test_task_planner_decomposition(self):
        """测试 TaskPlanner 对复杂任务的结构化拆解输出"""
        planner = TaskPlanner(client=self.mock_client, model=self.model)
        mock_choice = MagicMock()
        mock_choice.message.content = '''
        [
          {"id": "t1", "title": "扫描并定位目标接口", "completed": false},
          {"id": "t2", "title": "修改代码并应用补丁", "completed": false},
          {"id": "t3", "title": "执行单元测试验证闭环", "completed": false}
        ]
        '''
        self.mock_client.chat.completions.create.return_value = MagicMock(choices=[mock_choice])

        tasks = planner.plan_tasks("请修复 backend/core/agent.py 中的 bug 并运行测试")
        self.assertEqual(len(tasks), 3)
        self.assertEqual(tasks[0]["id"], "t1")
        self.assertEqual(tasks[0]["title"], "扫描并定位目标接口")
        self.assertFalse(tasks[0]["completed"])

    def test_critic_verifier_pass(self):
        """测试 CriticVerifier 对通过状态的审查"""
        critic = CriticVerifier(client=self.mock_client, model=self.model)
        mock_choice = MagicMock()
        mock_choice.message.content = '{"passed": true, "score": 4.8, "reason": "代码逻辑闭环且规范", "actionable_fix": ""}'
        self.mock_client.chat.completions.create.return_value = MagicMock(choices=[mock_choice])

        with patch.object(critic, 'run_physical_tests', return_value=None):
            res = critic.verify_turn(
                user_prompt="优化登录接口",
                tasks=[{"id": "t1", "title": "优化登录", "completed": True}],
                assistant_reply="已经完成登录接口的优化并保存。"
            )
            self.assertTrue(res["passed"])
            self.assertGreaterEqual(res["score"], 4.0)
            self.assertIn("dimensions", res)
            self.assertGreaterEqual(len(res["dimensions"]), 3)
            self.assertTrue(all("name" in d and "score" in d for d in res["dimensions"]))

    def test_critic_verifier_physical_test_interception(self):
        """测试 CriticVerifier 在物理单元测试失败时的直接拦截"""
        critic = CriticVerifier(client=self.mock_client, model=self.model)
        with patch.object(critic, 'run_physical_tests', return_value={
            "framework": "pytest",
            "exit_code": 1,
            "passed": False,
            "output": "FAILED test_login.py::test_auth"
        }):
            res = critic.verify_turn(
                user_prompt="重构鉴权模块",
                tasks=[{"id": "t1", "title": "重构鉴权", "completed": True}],
                assistant_reply="重构完成"
            )
            self.assertFalse(res["passed"])
            self.assertIn("自动化测试", res["reason"])
            self.assertIn("FAILED test_login.py", res["actionable_fix"])
            self.assertIn("dimensions", res)
            self.assertGreaterEqual(len(res["dimensions"]), 3)

    def test_react_agent_pure_dialogue_skips_critic(self):
        """测试当智能体未调用任何工具（纯对话/你好）时，完全跳过 Critic 验收且不发送评测卡片"""
        ledger = BudgetLedger(total_budget=50000)
        cm = ContextManager("test_pure_dialogue_sess", budget_ledger=ledger)

        with patch("core.agent.create_resilient_openai_client", return_value=self.mock_client):
            agent = ReActAgent(
                api_key="mock_key",
                base_url="https://mock.api",
                model="mock-model",
                context_manager=cm
            )

        agent.critic.verify_turn = MagicMock()

        # 大模型直接返回友好问答，无任何 tool_calls
        mock_choice = MagicMock()
        mock_choice.message.tool_calls = None
        mock_choice.message.content = "你好！有什么我可以帮你的？"
        mock_choice.message.reasoning_content = "用户在打招呼，直接礼貌回答。"
        self.mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=20, completion_tokens=15, total_tokens=35)
        )

        captured_critic = []
        def on_critic(crit):
            captured_critic.append(crit)

        res = agent.run(
            user_prompt="你好",
            verbose=False,
            critic_callback=on_critic
        )

        self.assertEqual(res, "你好！有什么我可以帮你的？")
        # 核心断言：未调用工具时，Critic.verify_turn 绝不执行，critic_callback 绝不触发
        agent.critic.verify_turn.assert_not_called()
        self.assertEqual(len(captured_critic), 0)

    def test_react_agent_with_tools_runs_critic(self):
        """测试当智能体调用了工具（执行了工程操作）时，正常触发 Critic 进行质量验收"""
        ledger = BudgetLedger(total_budget=50000)
        cm = ContextManager("test_tools_critic_sess", budget_ledger=ledger)

        with patch("core.agent.create_resilient_openai_client", return_value=self.mock_client):
            agent = ReActAgent(
                api_key="mock_key",
                base_url="https://mock.api",
                model="mock-model",
                context_manager=cm
            )

        agent.planner.plan_tasks = MagicMock(return_value=[
            {"id": "t1", "title": "运行测试命令", "completed": False}
        ])

        # 模拟工具执行
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.function.name = "run_shell"
        mock_tool_call.function.arguments = '{"command": "echo test"}'

        choice_step1 = MagicMock()
        choice_step1.message.tool_calls = [mock_tool_call]
        choice_step1.message.content = ""
        choice_step1.message.reasoning_content = "先执行命令探测环境"

        choice_step2 = MagicMock()
        choice_step2.message.tool_calls = None
        choice_step2.message.content = "已成功完成命令执行与结果交付。"
        choice_step2.message.reasoning_content = "完成总结。"

        self.mock_client.chat.completions.create.side_effect = [
            MagicMock(choices=[choice_step1], usage=MagicMock(prompt_tokens=50, completion_tokens=20, total_tokens=70)),
            MagicMock(choices=[choice_step2], usage=MagicMock(prompt_tokens=60, completion_tokens=25, total_tokens=85))
        ]

        agent.executor.execute_tool_calls = MagicMock(return_value=[
            {"tool_call_id": "call_123", "content": "test output"}
        ])

        agent.critic.verify_turn = MagicMock(return_value={
            "passed": True,
            "score": 5.0,
            "reason": "执行成果验证通过"
        })

        captured_critic = []
        def on_critic(crit):
            captured_critic.append(crit)

        res = agent.run(
            user_prompt="运行测试命令并汇报",
            verbose=False,
            critic_callback=on_critic
        )

        self.assertEqual(res, "已成功完成命令执行与结果交付。")
        # 核心断言：因调用了工具，Critic 审查被正常触发
        agent.critic.verify_turn.assert_called_once()
        self.assertTrue(any(c.get("status") == "passed" for c in captured_critic))

    def test_sequential_task_progress_never_jumps(self):
        """测试任务清单严格单调递增打钩，绝不会出现第一项和第三项完成而第二项仍处于执行中的Bug"""
        ledger = BudgetLedger(total_budget=50000)
        cm = ContextManager("test_monotonic_tasks_sess", budget_ledger=ledger)

        with patch("core.agent.create_resilient_openai_client", return_value=self.mock_client):
            agent = ReActAgent(
                api_key="mock_key",
                base_url="https://mock.api",
                model="mock-model",
                context_manager=cm
            )

        tasks = [
            {"id": "t1", "title": "设计广州旅游网页内容与排版", "completed": False},
            {"id": "t2", "title": "生成HTML文件并保存至桌面", "completed": False},
            {"id": "t3", "title": "验证文件生成与内容完整性", "completed": False}
        ]
        agent.planner.plan_tasks = MagicMock(return_value=tasks)

        # 模拟步骤 1：仅调用 run_shell 获取桌面路径
        call_shell = MagicMock()
        call_shell.id = "c1"
        call_shell.function.name = "run_shell"
        call_shell.function.arguments = '{"command": "powershell [Environment]::GetFolderPath(\'Desktop\')"}'

        choice_1 = MagicMock()
        choice_1.message.tool_calls = [call_shell]
        choice_1.message.content = ""
        choice_1.message.reasoning_content = "获取桌面路径"

        # 模拟步骤 2：调用 write_file 落地文件
        call_write = MagicMock()
        call_write.id = "c2"
        call_write.function.name = "write_file"
        call_write.function.arguments = '{"file_path": "C:/Desktop/travel.html", "content": "<html></html>"}'

        choice_2 = MagicMock()
        choice_2.message.tool_calls = [call_write]
        choice_2.message.content = ""
        choice_2.message.reasoning_content = "写入 HTML 网页"

        # 模拟步骤 3：结束并交付
        choice_3 = MagicMock()
        choice_3.message.tool_calls = None
        choice_3.message.content = "广州旅游网页已成功在桌面生成完毕！"
        choice_3.message.reasoning_content = "全部完成"

        self.mock_client.chat.completions.create.side_effect = [
            MagicMock(choices=[choice_1], usage=MagicMock(prompt_tokens=50, completion_tokens=20, total_tokens=70)),
            MagicMock(choices=[choice_2], usage=MagicMock(prompt_tokens=60, completion_tokens=20, total_tokens=80)),
            MagicMock(choices=[choice_3], usage=MagicMock(prompt_tokens=70, completion_tokens=20, total_tokens=90))
        ]

        def fake_exec(calls, **kwargs):
            first = calls[0]
            name = getattr(first.function, "name", "")
            return [{"tool_call_id": getattr(first, "id", "c"), "content": "success"}]

        agent.executor.execute_tool_calls = fake_exec
        agent.critic.verify_turn = MagicMock(return_value={"passed": True, "score": 5.0, "reason": "通过"})

        progress_history = []
        def on_progress(tid, completed):
            progress_history.append((tid, completed, [t["completed"] for t in tasks]))

        agent.run(
            user_prompt="在桌面生成一个广州的简单旅游网页，html格式",
            verbose=False,
            task_progress_callback=on_progress
        )

        # 验证在历史推进记录中，绝不存在 t3 已完成而 t2 未完成的状态！
        for tid, comp, snapshot in progress_history:
            t1_done, t2_done, t3_done = snapshot
            if t3_done:
                self.assertTrue(t2_done, f"非法状态：任务3完成时任务2必须已完成！快照: {snapshot}")

        # 最终交付时全部任务均已达成
        self.assertTrue(tasks[0]["completed"])
        self.assertTrue(tasks[1]["completed"])
        self.assertTrue(tasks[2]["completed"])

    def test_task_planner_robust_json_extraction(self):
        """测试 TaskPlanner 对包含前后解说文字与 Markdown 代码块的模型输出的容错提取能力"""
        planner = TaskPlanner(client=self.mock_client, model=self.model)
        mock_choice = MagicMock()
        mock_choice.message.content = """
        好的，根据您的需求，已为您规划如下工程步骤：
        ```json
        [
          {"id": "t1", "title": "扫描分析目录结构", "completed": false},
          {"id": "t2", "title": "生成 HTML 介绍文件", "completed": false}
        ]
        ```
        请按照上述步骤执行！
        """
        self.mock_client.chat.completions.create.return_value = MagicMock(choices=[mock_choice])

        statuses = []
        tasks = planner.plan_tasks(
            "在桌面生成一个html格式的super智能体的多agent设计的介绍",
            status_callback=lambda s: statuses.append(s)
        )
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0]["title"], "扫描分析目录结构")
        self.assertTrue(any("正在分析" in s for s in statuses))

    def test_status_callback_propagation_in_agent(self):
        """测试 ReActAgent 运行全生命周期正确向 status_callback 上报 stage 与 message"""
        ledger = BudgetLedger(total_budget=50000)
        cm = ContextManager("test_status_sess", budget_ledger=ledger)

        with patch("core.agent.create_resilient_openai_client", return_value=self.mock_client):
            agent = ReActAgent(
                api_key="mock_key",
                base_url="https://mock.api",
                model="mock-model",
                context_manager=cm
            )

        agent.planner.plan_tasks = MagicMock(return_value=[
            {"id": "task_1", "title": "分析模块", "completed": False}
        ])

        mock_choice = MagicMock()
        mock_choice.message.tool_calls = None
        mock_choice.message.content = "全部任务执行完成。"
        mock_choice.message.reasoning_content = "完成思考。"
        self.mock_client.chat.completions.create.return_value = MagicMock(
            choices=[mock_choice],
            usage=MagicMock(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        )

        recorded_stages = []
        def on_status(info):
            recorded_stages.append(info.get("stage"))

        agent.run(
            user_prompt="实现新功能模块",
            verbose=False,
            status_callback=on_status
        )

        self.assertIn("planning", recorded_stages)
        self.assertIn("thinking", recorded_stages)


    def test_desktop_path_allowed_in_workspace_and_file_tools(self):
        """测试用户桌面路径 (Desktop) 作为合法输出目标，允许生成与写入文件"""
        from tools.framework.workspace import default_workspace, set_workspace_root, get_user_desktop_dir
        from tools.builtin.file_tools import _validate_safe_path

        # 模拟在独立自由会话 scratchpad 中
        scratchpad = Path.home() / ".super-harness" / "scratchpad"
        set_workspace_root(scratchpad)

        desktop_file = str(get_user_desktop_dir() / "广州旅游指南.html")
        # 路径校验必须通过，绝不抛出 PermissionError
        safe_path = _validate_safe_path(desktop_file)
        self.assertEqual(str(safe_path), desktop_file)
        self.assertTrue(default_workspace.is_inside(desktop_file))


    def test_critic_persistence_to_disk_and_turns_parsing(self):
        """测试 Critic 审查结果能持久化写入磁盘并在会话重载/解析时无损还原"""
        import tempfile
        import shutil
        from server.app import parse_project_turns_from_disk
        import server.app as app_module

        temp_hist_dir = Path(tempfile.mkdtemp())
        proj_name = "test_critic_persist_proj"
        sid = "sess_critic_test"
        (temp_hist_dir / proj_name).mkdir(parents=True, exist_ok=True)

        orig_hist = app_module.HISTORY_ROOT
        try:
            app_module.HISTORY_ROOT = temp_hist_dir
            ledger = BudgetLedger(total_budget=50000)
            cm = ContextManager(sid, budget_ledger=ledger, project_name=proj_name, base_dir=temp_hist_dir / proj_name)

            cm.start_new_turn("请生成页面")
            cm.add_assistant_message({"role": "assistant", "content": "正在生成"})
            critic_data = {
                "status": "passed",
                "score": 4.9,
                "reason": "代码与页面已闭环验证",
                "dimensions": [
                    {"name": "目标规划对齐度", "score": 5.0, "passed": True, "detail": "100% 达成需求"},
                    {"name": "代码规范与无副作用", "score": 4.8, "passed": True, "detail": "无异常"},
                    {"name": "成果落地与可用性", "score": 5.0, "passed": True, "detail": "页面生成完整"}
                ]
            }
            cm.record_critic(critic_data)
            cm.finish_current_turn(elapsed=2.5)

            # 从磁盘解析
            parsed = parse_project_turns_from_disk(proj_name, sid)
            self.assertEqual(len(parsed["turns"]), 1)
            turn_0 = parsed["turns"][0]
            self.assertIsNotNone(turn_0.get("critic"))
            self.assertEqual(turn_0["critic"]["status"], "passed")
            self.assertEqual(turn_0["critic"]["score"], 4.9)
            self.assertEqual(turn_0["critic"]["reason"], "代码与页面已闭环验证")
            self.assertIn("dimensions", turn_0["critic"])
            self.assertEqual(len(turn_0["critic"]["dimensions"]), 3)
            self.assertEqual(turn_0["critic"]["dimensions"][0]["name"], "目标规划对齐度")
        finally:
            app_module.HISTORY_ROOT = orig_hist
            shutil.rmtree(temp_hist_dir, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
