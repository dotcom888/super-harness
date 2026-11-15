# -*- coding: utf-8 -*-
"""
tools/framework/sandbox/base.py: 沙箱抽象基类与数据结构定义
定义统一的沙箱配置 (SandboxConfig)、执行结果 (ExecResult) 与基础引擎接口 (BaseSandbox)。
"""
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Literal


@dataclass
class SandboxConfig:
    backend: Literal["auto", "native", "docker", "direct"] = "auto"
    max_memory_mb: int = 2048         # 默认内存上限 2048 MB (2GB)
    timeout_seconds: int = 60         # 默认命令超时 60s
    max_processes: int = 32           # 最大并发子进程数 (防 Fork-Bomb)
    network_mode: Literal["full", "restricted", "offline"] = "restricted"
    allow_desktop_output: bool = True # 是否允许向用户桌面输出


@dataclass
class ExecResult:
    stdout: str
    stderr: str
    exit_code: int
    elapsed: float
    peak_memory_mb: float = 0.0
    timed_out: bool = False
    killed_by_limit: bool = False
    sandbox_backend: str = "direct"
    error_message: Optional[str] = None
    extra_metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_success(self) -> bool:
        return self.exit_code == 0 and not self.timed_out and not self.killed_by_limit


class BaseSandbox(ABC):
    """沙箱引擎抽象基类"""
    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or SandboxConfig()

    @abstractmethod
    def execute(
        self,
        command: str,
        cwd: str,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None
    ) -> ExecResult:
        """在沙箱隔离环境中执行 Shell 命令并返回标准化 ExecResult"""
        pass

    def cleanup(self) -> None:
        """清理沙箱资源（临时文件、僵尸进程树或系统句柄）"""
        pass
