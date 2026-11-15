# -*- coding: utf-8 -*-
import sys
import unittest
from pathlib import Path

# 添加 backend 到路径
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from tools.framework.sandbox import (
    SandboxManager,
    SandboxConfig,
    DirectSubprocessSandbox,
    default_sandbox_manager
)
from tools.builtin.shell_tool import run_shell


class TestEnterpriseSandbox(unittest.TestCase):
    def test_sandbox_config_defaults(self):
        """测试沙箱默认配置参数（2GB 内存配额、60s 超时、受限网络）"""
        cfg = SandboxConfig()
        self.assertEqual(cfg.max_memory_mb, 2048)
        self.assertEqual(cfg.timeout_seconds, 60)
        self.assertEqual(cfg.max_processes, 32)
        self.assertEqual(cfg.network_mode, "restricted")

    def test_direct_sandbox_execution(self):
        """测试基础子进程沙箱执行与返回"""
        sandbox = DirectSubprocessSandbox(SandboxConfig(timeout_seconds=5))
        res = sandbox.execute("python -c \"print('DIRECT_OK')\"", cwd=str(Path.cwd()))
        self.assertTrue(res.is_success)
        self.assertIn("DIRECT_OK", res.stdout)
        self.assertFalse(res.timed_out)

    def test_native_windows_sandbox_accounting(self):
        """测试 Windows 原生 Job Object 沙箱的内存监控与进程隔离"""
        if sys.platform != "win32":
            self.skipTest("仅在 Windows 平台执行 Job Object 内核测试")

        from tools.framework.sandbox.native_windows import WindowsJobObjectSandbox
        cfg = SandboxConfig(max_memory_mb=1024, timeout_seconds=5)
        sandbox = WindowsJobObjectSandbox(cfg)

        res = sandbox.execute("python -c \"import time; time.sleep(0.05); print('JOB_OBJECT_OK')\"", cwd=str(Path.cwd()))
        self.assertTrue(res.is_success)
        self.assertIn("JOB_OBJECT_OK", res.stdout)
        self.assertEqual(res.sandbox_backend, "native_windows_job_object")
        # 验证真实获取到了内核级物理内存峰值
        self.assertGreater(res.peak_memory_mb, 0.0)
        self.assertLess(res.peak_memory_mb, 500.0)

    def test_sandbox_timeout_enforcement(self):
        """测试沙箱超时强杀机制（确保子进程树被安全切断且不挂起）"""
        sandbox = default_sandbox_manager.get_sandbox()
        res = sandbox.execute("python -c \"import time; time.sleep(10)\"", cwd=str(Path.cwd()), timeout=1)
        self.assertTrue(res.timed_out)
        self.assertFalse(res.is_success)
        self.assertIsNotNone(res.error_message)

    def test_shell_tool_sandbox_integration(self):
        """测试 run_shell 工具已全面接入沙箱调度"""
        out = run_shell("python -c \"print('SHELL_TOOL_SANDBOX_SUCCESS')\"")
        self.assertIn("执行状态: 成功", out)
        self.assertIn("SHELL_TOOL_SANDBOX_SUCCESS", out)

    def test_sandbox_status_reporting(self):
        """测试沙箱管理器状态遥测信息"""
        status = default_sandbox_manager.get_status()
        self.assertIn("backend", status)
        self.assertIn("is_hardened", status)
        self.assertEqual(status["max_memory_mb"], 2048)
        if sys.platform == "win32":
            self.assertTrue(status["is_hardened"])
            self.assertIn("JobObject", status["backend"])


if __name__ == "__main__":
    unittest.main()
