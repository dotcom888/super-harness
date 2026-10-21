# -*- coding: utf-8 -*-
import os
import time
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from context import ContextManager, TurnChunk
from server.app import parse_project_turns_from_disk
from core.agent import ReActAgent
from core.session import SessionManager
from openai import APITimeoutError

class TestTurnElapsedAndResilience(unittest.TestCase):
    def setUp(self):
        self.session_id = f"test_elapsed_{int(time.time()*1000)}"
        self.mgr = ContextManager(self.session_id)
        self.mgr.clear()

    def tearDown(self):
        if self.mgr.history_file.exists():
            try:
                os.remove(self.mgr.history_file)
            except Exception:
                pass

    def test_elapsed_and_timestamps_persistence(self):
        """验证轮次真实耗时与时间戳能够准确持久化并恢复"""
        self.mgr.start_new_turn("请分析项目代码")
        self.mgr.add_assistant_message({"role": "assistant", "content": "正在分析中..."})
        
        # 模拟执行了 4.2 秒
        self.mgr.finish_current_turn(elapsed=4.2)
        
        # 验证落盘记录中包含真实 elapsed 与时间戳
        self.assertTrue(self.mgr.history_file.exists())
        lines = [json.loads(l) for l in self.mgr.history_file.read_text("utf-8").splitlines() if l.strip()]
        finished_entries = [e for e in lines if e.get("type") == "turn_finished"]
        self.assertEqual(len(finished_entries), 1)
        self.assertEqual(finished_entries[0]["data"].get("elapsed"), 4.2)
        self.assertIn("start_time", finished_entries[0]["data"])
        self.assertIn("end_time", finished_entries[0]["data"])

        # 验证 restore_from_disk 还原
        mgr2 = ContextManager(self.session_id)
        self.assertTrue(mgr2.restore_from_disk())
        self.assertEqual(len(mgr2.completed_turns), 1)
        self.assertEqual(mgr2.completed_turns[0].elapsed, 4.2)

        # 验证 vacuum 之后依然保留 elapsed
        mgr2.vacuum()
        lines_after_vacuum = [json.loads(l) for l in self.mgr.history_file.read_text("utf-8").splitlines() if l.strip()]
        fin_v = [e for e in lines_after_vacuum if e.get("type") == "turn_finished"]
        self.assertEqual(len(fin_v), 1)
        self.assertEqual(fin_v[0]["data"].get("elapsed"), 4.2)

    def test_parse_project_turns_from_disk_timestamps(self):
        """验证从磁盘还原会话时区分 start_timestamp 与 completed_timestamp"""
        self.mgr.start_new_turn("用户提问")
        self.mgr.add_assistant_message({"role": "assistant", "content": "智能体回答"})
        self.mgr.finish_current_turn(elapsed=5.5)

        proj_name = self.mgr.history_dir.name
        parsed = parse_project_turns_from_disk(proj_name, self.session_id)
        self.assertIn("turns", parsed)
        self.assertEqual(len(parsed["turns"]), 1)
        turn_data = parsed["turns"][0]
        
        self.assertEqual(turn_data.get("elapsed"), 5.5)
        self.assertIn("start_timestamp", turn_data)
        self.assertIn("completed_timestamp", turn_data)
        self.assertIn("timestamp", turn_data)
        self.assertEqual(turn_data["timestamp"], turn_data["completed_timestamp"])

    def test_agent_retry_on_transient_error(self):
        """验证 Agent 在遭遇超时或瞬时网络异常时触发重试并在成功后收尾"""
        sess_mgr = SessionManager(default_session_id=self.session_id)
        agent = ReActAgent(api_key="test_key", model="test_model", session_manager=sess_mgr)
        
        mock_response = MagicMock()
        mock_msg = MagicMock()
        mock_msg.content = "任务已完成"
        mock_msg.tool_calls = None
        mock_msg.reasoning_content = "经过测试分析无误"
        mock_choice = MagicMock()
        mock_choice.message = mock_msg
        mock_response.choices = [mock_choice]
        mock_response.usage = None

        agent.client = MagicMock()
        agent.client.chat.completions.create.side_effect = [
            APITimeoutError(MagicMock()),
            mock_response
        ]

        # 确保 _convert_response_to_dict 返回 tool_calls 为空
        orig_convert = agent._convert_response_to_dict
        agent._convert_response_to_dict = lambda m: {
            "role": "assistant",
            "content": "任务已完成",
            "reasoning_content": "经过测试分析无误",
            "tool_calls": []
        }

        result = agent.run("运行测试", verbose=False)
        self.assertEqual(result, "任务已完成")
        self.assertEqual(agent.client.chat.completions.create.call_count, 2)


    def test_agent_graceful_wrapup_when_midtask_retries_exhausted(self):
        """验证中途执行多步工具后若上游网络彻底断开，优雅收拢已完成成果而不抛出硬崩溃"""
        sess_mgr = SessionManager(default_session_id=self.session_id)
        agent = ReActAgent(api_key="test_key", model="test_model", session_manager=sess_mgr)
        
        # 预设已经检查并修改了文件
        agent.context_manager.working_memory.inspected_files["boss_feishu_sync.py"] = "第 1 至 50 行"
        agent.context_manager.working_memory.modified_files.append("boss_feishu_sync.py")
        
        agent.client = MagicMock()
        # 模拟所有 3 次重试均超时
        agent.client.chat.completions.create.side_effect = APITimeoutError(MagicMock())

        # 不应抛出异常，而是优雅返回阶段性成果报告
        result = agent.run("运行排查任务", verbose=False)
        self.assertIn("已安全保全当前任务排查进度与工程成果", result)
        self.assertIn("boss_feishu_sync.py", result)
        self.assertIn("已修改文件", result)

if __name__ == "__main__":
    unittest.main()
