# -*- coding: utf-8 -*-
"""
tools/framework/sandbox/native_windows.py: Windows 原生内核级 Job Object 沙箱引擎
通过 Windows 内核 Job Object 实施硬配额管控：
1. 内存硬限额保护 (Job Memory Limit & Process Memory Limit)，杜绝 OOM 拖垮系统；
2. 进程数上限限额 (Active Process Limit)，防御 Fork-Bomb 恶意子进程派生；
3. 内核级关闭自毁 (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)，秒级强杀整棵子进程树，杜绝孤儿进程僵死；
4. 真实采集峰值物理内存占用 (PeakJobMemoryUsed)。
"""
import os
import sys
import time
import ctypes
from ctypes import wintypes
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


# 仅在 Windows 环境下加载 ctypes Windows API
if sys.platform == "win32":
    kernel32 = ctypes.windll.kernel32

    # Job Object Limit Flags
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x0008
    JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x0100
    JOB_OBJECT_LIMIT_JOB_MEMORY = 0x0200
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x0400
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
            ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]


class WindowsJobObjectSandbox(BaseSandbox):
    """基于 Windows 内核作业对象 (Job Object) 的强约束原生沙箱"""
    def __init__(self, config: Optional[SandboxConfig] = None):
        super().__init__(config)

    def execute(
        self,
        command: str,
        cwd: str,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None
    ) -> ExecResult:
        if sys.platform != "win32":
            raise RuntimeError("WindowsJobObjectSandbox 仅支持 Windows 系统环境。")

        safe_timeout = timeout or self.config.timeout_seconds
        start_t = time.time()
        timed_out = False
        killed_by_limit = False
        error_msg = None
        peak_mem_mb = 0.0

        # 1. 创建专用独立内核 Job Object
        job_handle = kernel32.CreateJobObjectW(None, None)
        if not job_handle:
            # 降级容错
            return self._fallback_direct(command, cwd, env, safe_timeout)

        proc_handle = None
        try:
            # 2. 配置作业硬限制 (Kill-on-Close + 内存配额 + 最大进程数)
            limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            mem_bytes = int(self.config.max_memory_mb * 1024 * 1024)
            flags = (
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
                JOB_OBJECT_LIMIT_JOB_MEMORY |
                JOB_OBJECT_LIMIT_PROCESS_MEMORY |
                JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
                JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
            )
            limits.BasicLimitInformation.LimitFlags = flags
            limits.JobMemoryLimit = mem_bytes
            limits.ProcessMemoryLimit = mem_bytes
            limits.BasicLimitInformation.ActiveProcessLimit = max(4, self.config.max_processes)

            kernel32.SetInformationJobObject(
                job_handle,
                9,  # JobObjectExtendedLimitInformation
                ctypes.byref(limits),
                ctypes.sizeof(limits)
            )

            # 3. 启动子进程
            proc = subprocess.Popen(
                command,
                shell=True,
                cwd=cwd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env
            )

            # 4. 立即将子进程加入 Job Object 沙箱监管
            proc_handle = kernel32.OpenProcess(0x1F0FFF, False, proc.pid)
            if proc_handle:
                kernel32.AssignProcessToJobObject(job_handle, proc_handle)

            # 5. 等待执行与超时强杀
            try:
                raw_stdout, raw_stderr = proc.communicate(timeout=safe_timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                error_msg = f"命令执行超过 {safe_timeout} 秒上限，已通过 Windows 内核 JobObject 强杀全部子进程！"
                kernel32.TerminateJobObject(job_handle, 1)
                try:
                    subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True, timeout=3)
                except Exception:
                    pass
                try:
                    raw_stdout, raw_stderr = proc.communicate(timeout=2)
                except Exception:
                    raw_stdout, raw_stderr = b"", b""

            # 6. 查询峰值内存使用
            info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            if kernel32.QueryInformationJobObject(
                job_handle,
                9,
                ctypes.byref(info),
                ctypes.sizeof(info),
                None
            ):
                peak_bytes = max(info.PeakJobMemoryUsed, info.PeakProcessMemoryUsed)
                peak_mem_mb = round(peak_bytes / (1024 * 1024), 2)
                if peak_bytes >= mem_bytes * 0.98:
                    killed_by_limit = True
                    error_msg = f"【沙箱内存配额熔断】：进程内存触达 {self.config.max_memory_mb} MB 上限，已被内核安全拦截！"

        finally:
            if proc_handle:
                kernel32.CloseHandle(proc_handle)
            if job_handle:
                kernel32.CloseHandle(job_handle)

        elapsed = round(max(0.01, time.time() - start_t), 2)
        stdout = _decode_stream(raw_stdout)
        stderr = _decode_stream(raw_stderr)
        exit_code = -1 if timed_out else proc.returncode

        return ExecResult(
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            elapsed=elapsed,
            peak_memory_mb=peak_mem_mb,
            timed_out=timed_out,
            killed_by_limit=killed_by_limit,
            sandbox_backend="native_windows_job_object",
            error_message=error_msg,
            extra_metadata={
                "memory_limit_mb": self.config.max_memory_mb,
                "process_limit": self.config.max_processes
            }
        )

    def _fallback_direct(self, command: str, cwd: str, env: Optional[Dict[str, str]], timeout: int) -> ExecResult:
        from .direct import DirectSubprocessSandbox
        return DirectSubprocessSandbox(self.config).execute(command, cwd, env, timeout)
