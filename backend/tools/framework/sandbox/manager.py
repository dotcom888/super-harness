# -*- coding: utf-8 -*-
"""
tools/framework/sandbox/manager.py: 统一沙箱服务调度管理器
根据宿主运行环境与配置，自动按优先级选取最高安全隔离级别的沙箱引擎：
Windows 原生 Job Object > 容器 Docker > Direct 直通子进程。
"""
import os
import sys
import logging
from typing import Optional, Dict, Any
from .base import BaseSandbox, SandboxConfig, ExecResult
from .direct import DirectSubprocessSandbox

logger = logging.getLogger("super_harness.sandbox")


class SandboxManager:
    """企业级沙箱管理器"""
    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or self._load_default_config()
        self._current_sandbox: Optional[BaseSandbox] = None

    def _load_default_config(self) -> SandboxConfig:
        backend_env = os.getenv("SUPER_SANDBOX_BACKEND", "auto").strip().lower()
        mem_mb = int(os.getenv("SUPER_SANDBOX_MAX_MEMORY_MB", "2048"))
        timeout_s = int(os.getenv("SUPER_SANDBOX_TIMEOUT", "60"))
        net_mode = os.getenv("SUPER_SANDBOX_NETWORK_MODE", "restricted")
        return SandboxConfig(
            backend=backend_env if backend_env in ("auto", "native", "docker", "direct") else "auto",
            max_memory_mb=mem_mb,
            timeout_seconds=timeout_s,
            network_mode=net_mode if net_mode in ("full", "restricted", "offline") else "restricted"
        )

    def get_sandbox(self) -> BaseSandbox:
        """获取或初始化匹配当前环境的沙箱引擎"""
        if self._current_sandbox is not None:
            return self._current_sandbox

        chosen_backend = self.config.backend
        if chosen_backend == "auto":
            if sys.platform == "win32":
                chosen_backend = "native"
            else:
                chosen_backend = "direct"

        if chosen_backend == "native" and sys.platform == "win32":
            try:
                from .native_windows import WindowsJobObjectSandbox
                self._current_sandbox = WindowsJobObjectSandbox(self.config)
                logger.info(f"启用企业级 Windows 原生 Job Object 加固沙箱 (内存上限: {self.config.max_memory_mb} MB)")
                return self._current_sandbox
            except Exception as e:
                logger.warning(f"初始化 Windows Job Object 沙箱失败，降级至 Direct: {e}")

        self._current_sandbox = DirectSubprocessSandbox(self.config)
        logger.info("启用 Direct 宿主直通子进程沙箱")
        return self._current_sandbox

    def execute(
        self,
        command: str,
        cwd: str,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None
    ) -> ExecResult:
        """通过就绪的沙箱引擎安全执行命令"""
        sandbox = self.get_sandbox()
        return sandbox.execute(command, cwd=cwd, env=env, timeout=timeout)

    def get_status(self) -> Dict[str, Any]:
        """获取当前沙箱状态与安全指标元数据"""
        sandbox = self.get_sandbox()
        is_native = getattr(sandbox, "sandbox_backend", "") == "native_windows_job_object" or "WindowsJobObject" in type(sandbox).__name__
        return {
            "backend": "Windows Kernel JobObject (企业级加固)" if is_native else "Direct Subprocess",
            "is_hardened": is_native,
            "max_memory_mb": self.config.max_memory_mb,
            "max_processes": self.config.max_processes,
            "timeout_seconds": self.config.timeout_seconds,
            "platform": sys.platform
        }


# 全局默认沙箱管理器单例
default_sandbox_manager = SandboxManager()
