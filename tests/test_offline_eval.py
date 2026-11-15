# -*- coding: utf-8 -*-
import unittest
from core.evaluator import OfflineTrajectoryEvaluator
from server.app import get_trajectory_eval

class TestOfflineTrajectoryEvaluator(unittest.TestCase):
    def setUp(self):
        self.evaluator = OfflineTrajectoryEvaluator()

    def test_evaluate_perfect_session(self):
        """测试完美达成闭环的会话获得高分与 A+ 评级，并产出逐轮次微观评测"""
        mock_turns = [
            {
                "turn_id": 1,
                "user_prompt": "在桌面生成文件",
                "assistant_response": "生成完成",
                "tasks": [
                    {"id": "t1", "title": "扫描环境", "completed": True},
                    {"id": "t2", "title": "写入文件", "completed": True}
                ],
                "actions": [
                    {
                        "id": "act_1",
                        "tool": "read_file",
                        "args": {"path": "main.py"},
                        "status": "success",
                        "output": "print('hello')",
                        "elapsed": 0.2
                    },
                    {
                        "id": "act_2",
                        "tool": "execute_command",
                        "args": {"command": "python main.py"},
                        "status": "success",
                        "output": "hello",
                        "elapsed": 0.5
                    }
                ],
                "critic": {
                    "status": "passed",
                    "score": 5.0,
                    "reason": "目标全部闭环完成"
                },
                "elapsed": 3.2
            }
        ]

        report = self.evaluator.evaluate_session(mock_turns, "test_proj", "test_sess")
        self.assertGreaterEqual(report["health_score"], 95.0)
        self.assertEqual(report["health_level"], "A+")
        self.assertEqual(report["metrics"]["tool_success_rate"], "100.0%")
        self.assertEqual(report["metrics"]["tool_errors_count"], 0)
        self.assertEqual(report["metrics"]["redundant_calls_count"], 0)
        self.assertEqual(report["metrics"]["task_completion_rate"], "100.0%")
        self.assertGreater(len(report["diagnostics"]), 0)
        self.assertIn("act_1", report["step_annotations"])
        self.assertEqual(report["step_annotations"]["act_1"]["badge_type"], "success")

        # 验证逐轮次评测
        self.assertIn("turns_eval", report)
        self.assertEqual(len(report["turns_eval"]), 1)
        turn_1_eval = report["turns_eval"][0]
        self.assertEqual(turn_1_eval["turn_id"], 1)
        self.assertGreaterEqual(turn_1_eval["health_score"], 95.0)
        self.assertEqual(turn_1_eval["health_level"], "A+")
        self.assertEqual(turn_1_eval["tool_calls_count"], 2)
        self.assertEqual(turn_1_eval["tool_errors_count"], 0)
        self.assertEqual(turn_1_eval["critic_status"], "passed")
        self.assertIn("闭环", turn_1_eval["turn_summary"])

    def test_evaluate_redundancy_and_errors(self):
        """测试多轮次中分别存在冗余与错误时单轮评测准确定位"""
        mock_turns = [
            {
                "turn_id": 1,
                "user_prompt": "排查问题",
                "assistant_response": "排查中",
                "tasks": [
                    {"id": "t1", "title": "排查", "completed": False}
                ],
                "actions": [
                    {
                        "id": "act_1",
                        "tool": "read_file",
                        "args": {"path": "config.json"},
                        "status": "success",
                        "output": "{}"
                    },
                    {
                        "id": "act_2",
                        "tool": "read_file",
                        "args": {"path": "config.json"},  # 连续重复读取相同文件 (冗余)
                        "status": "success",
                        "output": "{}"
                    },
                    {
                        "id": "act_3",
                        "tool": "execute_command",
                        "args": {"command": "bad_cmd"},
                        "status": "error",
                        "output": "【执行状态: 退出码 1】 command not found"
                    }
                ],
                "critic": {
                    "status": "rejected",
                    "score": 2.5,
                    "reason": "测试未通过"
                },
                "elapsed": 4.0
            },
            {
                "turn_id": 2,
                "user_prompt": "你好，请问你是谁？",
                "assistant_response": "我是 Super-Harness 智能助手。",
                "tasks": [],
                "actions": [],
                "elapsed": 1.1
            }
        ]

        report = self.evaluator.evaluate_session(mock_turns, "test_proj", "test_sess_err")
        self.assertLess(report["health_score"], 85.0)
        self.assertEqual(report["metrics"]["tool_errors_count"], 1)
        self.assertEqual(report["metrics"]["redundant_calls_count"], 1)
        self.assertEqual(report["step_annotations"]["act_2"]["is_redundant"], True)
        self.assertEqual(report["step_annotations"]["act_3"]["badge_type"], "error")

        # 验证单轮精确定位
        self.assertEqual(len(report["turns_eval"]), 2)
        turn_1 = report["turns_eval"][0]
        self.assertLess(turn_1["health_score"], 85.0)
        self.assertEqual(turn_1["tool_errors_count"], 1)
        self.assertEqual(turn_1["redundant_calls_count"], 1)

        turn_2 = report["turns_eval"][1]
        self.assertEqual(turn_2["health_score"], 100.0)
        self.assertEqual(turn_2["tool_calls_count"], 0)
        self.assertIn("即时问答", turn_2["turn_summary"])

if __name__ == "__main__":
    unittest.main()