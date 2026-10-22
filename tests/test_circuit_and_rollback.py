# -*- coding: utf-8 -*-
import pytest
import shutil
import time
from pathlib import Path
from starlette.testclient import TestClient

from server.app import app, HISTORY_ROOT
from server.agent_bridge import bridge
from core.agent import ReActAgent
from context.manager import ContextManager
from core.session import SessionManager
from context.snapshot import default_snapshot_manager
from tools.framework.workspace import WorkspaceContext

client = TestClient(app)

def test_circuit_msg_scope_and_preservation(tmp_path):
    ws = WorkspaceContext(tmp_path)
    sess_mgr = SessionManager(
        default_session_id=f"test_sess_{int(time.time()*1000)}",
        workspace=ws,
        project_name="test_proj",
        history_dir=tmp_path / "history"
    )
    agent = ReActAgent(
        api_key="test-key",
        model="gpt-test",
        session_manager=sess_mgr
    )

    cm = agent.context_manager
    cm.start_new_turn("用户提问：这是一个测试提示词")
    cm.add_assistant_message({"role": "assistant", "content": "第一步思考..."})
    
    # 验证上下文管理器的初始状态
    assert cm.current_turn is not None
    assert len(cm.current_turn.messages) >= 2

    # 执行 finally 逻辑
    if cm.current_turn and not cm.current_turn.messages:
        cm.abort_current_turn()

    # 验证没有被销毁
    assert cm.current_turn is not None
    assert cm.current_turn.messages[0]["content"] == "用户提问：这是一个测试提示词"

    # 上层追加异常信息并闭环
    err_card = "❌ 智能体系统内部执行异常 (TestError): 测试异常"
    cm.add_assistant_message(err_card)
    cm.finish_current_turn(elapsed=5.0)

    # 验证完整闭环保存至 completed_turns
    assert len(cm.completed_turns) == 1
    saved_turn = cm.completed_turns[0]
    assert saved_turn.messages[0]["content"] == "用户提问：这是一个测试提示词"
    assert saved_turn.messages[-1]["content"] == err_card


def test_session_rollback_api(tmp_path):
    ws_dir = tmp_path / "test_workspace"
    ws_dir.mkdir(parents=True, exist_ok=True)
    test_file = ws_dir / "sample.txt"
    test_file.write_text("initial content", encoding="utf-8")

    hist_dir = HISTORY_ROOT / "TestProj"
    hist_dir.mkdir(parents=True, exist_ok=True)
    sid = f"test_rollback_{int(time.time()*1000)}"
    hist_file = hist_dir / f"{sid}.jsonl"
    if hist_file.exists():
        hist_file.unlink()

    ws = WorkspaceContext(ws_dir)
    sess_mgr = SessionManager(
        default_session_id=sid,
        workspace=ws,
        project_name="TestProj",
        history_dir=hist_dir
    )
    agent = ReActAgent(
        api_key="test-key",
        model="gpt-test",
        session_manager=sess_mgr
    )

    cm = agent.context_manager
    snap_mgr = cm.snapshot_manager

    # 第一轮对话：无文件改动
    cm.start_new_turn("第 1 轮提问")
    cm.add_assistant_message("第 1 轮回答")
    cm.finish_current_turn(elapsed=2.0)

    # 第二轮对话：修改文件 sample.txt 并创建新文件 new_file.txt
    cm.start_new_turn("第 2 轮提问：修改文件")
    snap_mgr.backup_before_mutation(test_file)
    test_file.write_text("modified in turn 2", encoding="utf-8")

    new_file = ws_dir / "new_file.txt"
    snap_mgr.backup_before_mutation(new_file)
    new_file.write_text("created in turn 2", encoding="utf-8")

    cm.add_assistant_message("第 2 轮修改完成")
    cm.finish_current_turn(elapsed=3.0)

    # 验证当前状态：有2轮，文件已改
    assert len(cm.completed_turns) == 2
    assert test_file.read_text(encoding="utf-8") == "modified in turn 2"
    assert new_file.exists()

    # 通过 API 调用回滚
    bridge.agents[f"TestProj:{sid}"] = agent

    resp = client.post("/api/sessions/rollback", json={
        "project": "TestProj",
        "session_id": sid
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["remaining_turns_count"] == 1

    # 验证磁盘文件已还原
    assert test_file.read_text(encoding="utf-8") == "initial content"
    assert not new_file.exists()

    # 验证内存与历史中只剩第 1 轮
    assert len(cm.completed_turns) == 1
    assert cm.completed_turns[0].messages[0]["content"] == "第 1 轮提问"

    # 再次回滚第 1 轮
    resp2 = client.post("/api/sessions/rollback", json={
        "project": "TestProj",
        "session_id": sid
    })
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["success"] is True
    assert data2["remaining_turns_count"] == 0
    assert len(cm.completed_turns) == 0
    # 验证物理磁盘文件已彻底删除
    assert not hist_file.exists()

    # 此时没有轮次可撤销，再次调用应返回 success: False
    resp3 = client.post("/api/sessions/rollback", json={
        "project": "TestProj",
        "session_id": sid
    })
    assert resp3.status_code == 200
    data3 = resp3.json()
    assert data3["success"] is False

    # 清理
    if hist_file.exists():
        hist_file.unlink()


@pytest.mark.anyio
async def test_slash_commands_and_turn_persistence(tmp_path):
    from tools.framework.policies import default_policy
    orig_mode = getattr(default_policy, "mode", "auto")
    try:
        events = []
        def callback(ev):
            events.append(ev)

        sid = f"test_slash_{int(time.time()*1000)}"
        resp_help = await bridge.execute_prompt_stream(
            prompt="/help",
            event_callback=callback,
            session_id=sid,
            project_name="_general"
        )
        assert "快捷指令" in resp_help
        assert any(ev.get("event") == "assistant_response" for ev in events)

        resp_ctx = await bridge.execute_prompt_stream(
            prompt="/context",
            event_callback=callback,
            session_id=sid,
            project_name="_general"
        )
        assert "上下文" in resp_ctx

        resp_plan = await bridge.execute_prompt_stream(
            prompt="/plan",
            event_callback=callback,
            session_id=sid,
            project_name="_general"
        )
        assert "Plan 模式" in resp_plan

        resp_doc = await bridge.execute_prompt_stream(
            prompt="/doctor",
            event_callback=callback,
            session_id=sid,
            project_name="_general"
        )
        assert "自检报告" in resp_doc

        resp_ver = await bridge.execute_prompt_stream(
            prompt="/version",
            event_callback=callback,
            session_id=sid,
            project_name="_general"
        )
        assert "v5.7.16" in resp_ver
    finally:
        default_policy.mode = orig_mode
