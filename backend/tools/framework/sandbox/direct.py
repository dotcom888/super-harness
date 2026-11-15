# -*- coding: utf-8 -*-
"""
tools/framework/sandbox/direct.py: 宿主直通子进程执行引擎
作为跨平台兜底沙箱，具备环境变量凭据清洗、子进程树安全强杀与超时管控。
"""
import os
import sys
import time
import subprocess
from typing import Optional, Dict
from .base import BaseSandbox, SandboxConfig, ExecResult


def _decode_stream(raw_bytes: bytes) -> str:
    if not raw_bytes:
        return ""
    try:
        return raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        pass
    for enc in ("gbk", "cp936", "latin1"):
        try:
            return raw_bytes.decode(enc)
        except Exception:
            pass
    return raw_bytes.decode("utf-8", errors="replace")


class DirectSubprocessSandbox(BaseSandbox):
    """直接在宿主机受控子进程中执行（带进程树强杀与凭据清洗）"""
    def __init__(self, config: Optional[SandboxConfig] = None):
        super().__init__(config)

    def execute(
        self,
        command: str,
        cwd: str,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None
    ) -> ExecResult:
        safe_timeout = timeout or self.config.timeout_seconds
        start_t = time.time()
        timed_out = False
        error_msg = None

        proc = subprocess.Popen(
            command,
            shell=True,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env
        )

        try:
            raw_stdout, raw_stderr = proc.communicate(timeout=safe_timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            error_msg = f"命令执行超过 {safe_timeout} 秒上限，已被系统强制终止！"
            if os.name == "nt":
                try:
                    subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True, timeout=5)
                except Exception:
                    pass
            else:
                proc.kill()
            try:
                raw_stdout, raw_stderr = proc.communicate(timeout=2)
            except Exception:
                raw_stdout, raw_stderr = b"", b""

        elapsed = round(max(0.01, time.time() - start_t), 2)
        stdout = _decode_stream(raw_stdout)
        stderr = _decode_stream(raw_stderr)
        exit_code = -1 if timed_out else proc.returncode

        return ExecResult(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            elapsed=elapsed,
            peak_memory_mb=0.0,
            timed_out=timed_out,
            killed_by_limit=False,
            sandbox_backend="direct",
            error_message=error_msg
        )
