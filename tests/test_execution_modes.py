import pytest
from tools.framework.policies import default_policy, PolicyDecision
from core.prompt import build_system_prompt
from tools.builtin.file_tools import write_file

@pytest.fixture(autouse=True)
def reset_policy_mode():
    default_policy.mode = "auto"
    default_policy.reset_session_approval()
    yield
    default_policy.mode = "auto"
    default_policy.reset_session_approval()


def test_execution_mode_prompt_and_memory():
    # 1. Auto mode
    default_policy.mode = "auto"
    prompt_auto = build_system_prompt()
    assert "当前执行模式：Auto 模式" in prompt_auto

    # 2. Edit auto mode
    default_policy.mode = "edit_auto"
    prompt_edit = build_system_prompt()
    assert "当前执行模式：Edit automatically 自动编辑模式" in prompt_edit

    # 3. Plan mode
    default_policy.mode = "plan"
    prompt_plan = build_system_prompt()
    assert "当前执行模式：Plan 规划模式" in prompt_plan

    # 4. Manual mode
    default_policy.mode = "manual"
    prompt_manual = build_system_prompt()
    assert "当前执行模式：Manual 模式" in prompt_manual

def test_plan_mode_blocks_file_mutations():
    default_policy.mode = "plan"
    res = write_file(file_path="test_should_block.txt", content="test")
    assert "Plan 模式拦截" in res

def test_edit_auto_and_auto_shell_policy():
    default_policy.mode = "auto"
    dec, _ = default_policy.evaluate("echo safe")
    assert dec == PolicyDecision.ALLOW

    # Destructive commands are blocked in all modes
    dec, _ = default_policy.evaluate("rm -rf /")
    assert dec == PolicyDecision.DENY

    default_policy.mode = "edit_auto"
    # Whitelist command allowed
    dec, _ = default_policy.evaluate("git status")
    assert dec == PolicyDecision.ALLOW
    # Non-whitelist command requires approval
    dec, _ = default_policy.evaluate("python my_script.py")
    assert dec == PolicyDecision.REQUIRE_APPROVAL
