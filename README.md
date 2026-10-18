# Super-Harness 🚀

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Tests](https://img.shields.io/badge/tests-174%20passed-brightgreen.svg)](tests/)
[![Version](https://img.shields.io/badge/Release-v5.7.14-blue.svg)](https://github.com/dotcom888/super-harness/releases)
[![Context](https://img.shields.io/badge/Context-200K%20Budget%20Engine-orange.svg)](#3--200k-刚性分账上下文工程与三段式滑窗)
[![Protocol](https://img.shields.io/badge/MCP-JSON--RPC%202.0%20(0%20Ports)-blue.svg)](#6--mcp-model-context-protocol-外部分布式扩展)

> **Super-Harness** 是一款面向工业级真实软件工程的高性能自主代码编程智能体（Autonomous Coding Agent）。
> 具备 **现代桌面端 (Electron + React + Tailwind)** 与 **轻量级终端 (TUI)** 双模态交互，创新性地构建了 **200K 刚性精准分账上下文引擎**、**对齐 Claude Code 的 4 种安全执行模式**、**双轨真实思维链协议 (Thinking Protocol)**、**物理快照原子回滚机制** 与 **MCP 零端口外部进程扩展**。

---

## 🌟 核心特性与架构亮点

### 1. 🧠 任务感知型 ReAct 决策中枢与双轨真实思维链
- **全自主推理闭环**：严格遵循 `Thought -> Action -> Observation -> Final Answer` 逻辑流进。
- **双轨真实思维链协议 (Thinking Protocol)**：
  - **杜绝任何人工假数据与硬编码模板**，思考链 100% 由大模型实时推导生成；
  - **原生推理模型**（DeepSeek-R1 / OpenAI o1 / o3-mini 等）：底层自动透传原生的 `reasoning_content`，无损渲染其深度的长程推理；
  - **通用 Chat 模型**（Gemini / GPT-4o / DeepSeek-V3 等）：系统协议引导模型在 `<think>...</think>` 中自主梳理意图与调研规划，引擎在流式传输时进行微秒级结构化剥离，在保障思维链常驻的同时让最终回答纯粹干净。
- **智能死循环与停滞拦截 (`LoopDetector`)**：
  - 自动识别“完全相同工具重复调用”、“多工具周期性振荡”及“相同报错死磕停滞”；
  - 先出示“黄牌”反思注入，无效则“红牌”强行熔断切断工具并执行收敛汇报，杜绝无限空转与 Token 浪费。

### 2. 🎛️ 对标 Claude Code 的 4 种安全执行模式
系统提供细颗粒度的安全控制边界，支持随任务类型平滑切换：
- **`Auto` (全自动模式)**：常规排查、搜索与只读探索免确认执行，高危操作按策略拦截；
- **`Plan` (规划先行模式)**：先谋后动，深入代码调研后输出完整【实施方案】；在当前思考链中通过 `ask_user` 发起交互审批，批准后就地切换为执行态落地，无需重新发起会话；
- **`Edit` (代码免审模式)**：聚焦于文件安全修改与代码重构，文件读写与局部补丁免确认，终端破坏性 Shell 命令依然受控；
- **`Ask` (全量审批模式)**：每一步工具调用与文件写操作均需人工决策审批。

### 3. 💾 200K 刚性分账上下文工程与三段式滑窗
- **精细化刚性配额账本 (`BudgetLedger`)**：
  - **系统提示词区 (System)**：上限锁定 15%（约 30,000 Tokens）；
  - **工具能力定义区 (Tools Schema)**：极限锁定 10%（约 20,000 Tokens）；
  - **工作记忆与状态区 (WorkingMemory)**：约 4%（约 8,000 Tokens）；
  - **短期记忆历史滑动窗口区 (History)**：约 63% ~ 75%（触顶高水位 $≥ 75\%$ 时立即触发防抖压缩至 50%）；
  - **生成输出与单步回显保底**：模型单步生成刚性预留 **16,000 Tokens (8%)**，工具单步回显绝对保底 **5,000 Tokens**，杜绝大模型吐字或生成 Diff 补丁时发生截断。
- **原子轮次成对绑定 (`TurnChunk`)**：将单轮交互打成不可拆分的原子包，彻底杜绝单条消息截断导致 `tool_calls` 孤儿而触发 OpenAI API 400 校验异常。

### 4. 🖥️ 现代桌面端与终端统一支持
- **专业桌面端 (Desktop App)**：
  - 基于 Electron + React + TailwindCSS + Vite 深度定制；
  - 支持多工作区项目树、会话搜索、自由/项目级会话平滑归档；
  - 沉浸式流光溢彩思维链、耗时统计、实时 Markdown 代码块语法高亮与彩色 Unified Diff；
  - 输入草稿与附件持久化临时保护，切换会话零丢失。
- **一键全局启动**：
  - 在系统的任意路径终端中直接输入 `super` 即可快速唤起智能体（默认位于自由会话工作区 `_general`，无干扰免配置）。

### 5. 🛡️ 物理磁盘快照与无损回滚 (`SnapshotManager`)
- **写前快照 (Shadow Snapshot)**：任何修改代码与写入文件操作前，毫秒级备份原文件；
- **多文件事务原子性 (Patch Transaction)**：补丁修改中途只要有一处失败，自动事务级全量回滚，绝不留下半成品脏代码；
- **真实物理级 `/undo` 还原**：用户输入 `/undo` 时，不仅撤销对话历史，同时在物理硬盘上还原修改文件、删除新建文件，提供真正的“撤销后悔药”。

### 6. 🔌 MCP (Model Context Protocol) 外部分布式扩展
- **标准协议支持**：基于 JSON-RPC 2.0 Stdio（标准流管道 IPC）运行，通信全在内存管道中进行，**完全不占用任何本地网络端口（0 端口占用）**；
- **内核级生命周期托管**：Windows 下采用内核级 Job Object 托管进程树，注册退出钩子，进程退出时连带释放外部子进程，绝不残留僵尸后台；
- **命名空间与输出限额**：采用 `mcp__{server}__{tool}` 隔离前缀消除工具命名冲突，配置级单项输出限额拦截。

### 7. 🧩 原生 Skills 技能生态与统一目录治理
- 遵循行业主流 `SKILL.md` 规范（兼容 OpenAI / Claude Code 技能生态）；
- **用户状态统一存储**：所有会话历史、项目级状态及用户全局偏好集中归档于 `~/.super-harness/`；
- **工作区沉浸式隔离**：用户在具体项目中生成的交互附件统一存放在 `<Workspace>/.super-harness/attachments/`，绝不污染用户主源码树；
- 默认预置 4 套高阶专业工程技能：
  - **`codebase-design`**：复杂架构设计、DESIGN-IT-TWICE 方案推演；
  - **`codebase-onboarding`**：全新陌生长代码库极速上手与导读；
  - **`diagnosing-bugs`**：棘手缺陷定位、根因追踪与闭环验证；
  - **`domain-modeling`**：业务领域建模与架构决策记录 (ADR)。

---

## 📁 全新重构架构与目录结构

```text
super-harness/
│
├── backend/                     # 【后端核心工程引擎】
│   ├── core/                    # -- 认知与推理中枢
│   │   ├── agent.py             # ReActAgent: 纯净的多步推理循环引擎
│   │   ├── stage_manager.py     # 任务阶段状态机 (EXPLORE -> MODIFY -> VERIFY)
│   │   ├── loop_detector.py     # 死循环与停滞智能检测熔断器
│   │   ├── session.py           # 多会话元数据管理核心
│   │   └── prompt.py            # 系统提示词规范与 Thinking Protocol
│   ├── context/                 # -- 上下文与记忆中枢
│   │   ├── budget.py            # 200k 刚性分账预算账本 (BudgetLedger)
│   │   ├── manager.py           # 会话上下文总管，三段式水位调度
│   │   ├── window.py            # 逆向滑动窗口与原子轮次 (TurnChunk)
│   │   ├── project_state.py     # 项目级跨会话共享工作区状态总线
│   │   ├── global_memory.py     # 用户全局跨工程偏好画像 (~/.super-harness)
│   │   ├── snapshot.py          # 物理磁盘快照与原子回滚事务
│   │   └── summarizer.py        # 区间追踪与三维防抖长期记忆摘要器
│   ├── server/                  # -- 高性能 FastAPI 异步调度服务
│   │   ├── agent_bridge.py      # WebSocket 实时事件桥接器与状态派发
│   │   ├── app.py               # REST API 端点 (会话/项目/模型/工作区管理)
│   │   └── run_server.py        # 服务入口 (支持独立进程与守护模式)
│   ├── tools/                   # -- 原生内置工具箱 (内置 16 项高频工程工具)
│   ├── skills/                  # -- 技能生态管理与 loader
│   ├── mcp/                     # -- MCP 零端口外部进程扩展
│   ├── config/                  # -- 模型解析器与环境配置
│   └── cli/                     # -- 终端控制台 TUI 实现
│
├── desktop/                     # 【桌面端客户端 (Electron + React)】
│   ├── src/                     # 前端源代码 (React 18 + TypeScript + Vite)
│   │   ├── components/          # 气泡组件、思考链渲染、设置弹窗等
│   │   └── App.tsx              # 主视窗与 WebSocket 实时状态流
│   ├── electron/                # Electron 主进程与 Preload IPC
│   ├── release/                 # 构建打包产物目录
│   └── package.json             # 桌面端依赖与打包配置
│
├── scripts/                     # 【运维与工程自动化脚本】
│   ├── super.bat / super.cmd    # 终端一键启动器
│   └── build_server.py          # 后端独立引擎 PyInstaller 自动化编译脚本
│
├── tests/                       # 【工业级全量自动化测试】(174 项测试用例全部覆盖)
├── requirements.txt             # 后端生产环境依赖
├── main.py                      # 统一命令行启动入口
└── README.md                    # 项目核心指南
```

---

## 🚀 快速上手与运行

### 1. 环境准备
确保已安装 Python 3.10+ 以及 Node.js 18+ 环境：
```bash
git clone https://github.com/dotcom888/super-harness.git
cd super-harness

# 创建并激活虚拟环境
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1

# 安装后端依赖
pip install -r requirements.txt

# 安装前端依赖
cd desktop
npm install
cd ..
```

### 2. 方式 A：直接运行桌面端（开发体验）
在项目根目录启动后端服务，并在 `desktop` 启动客户端：
```bash
# 启动后端服务 (端口 8765)
python backend/server/run_server.py 8765

# 启动桌面端界面
npm --prefix desktop run dev
```

### 3. 方式 B：终端交互模式 (CLI TUI)
无需桌面端，纯终端下快速启动自主编程助手：
```bash
python main.py
```
*(Windows 用户已配置好环境变量时，在任意目录下输入 `super` 即可一键启动)*

### 4. 运行全量自动化测试
在提交改动前，验证全量 174 项自动化测试：
```bash
pytest
```

---

## 📦 最新独立安装包下载 (Releases)

如果你不需要本地构建开发，可以直接前往 GitHub Releases 下载官方预编译的最新版本安装包：

👉 **[前往 GitHub Releases 最新版本下载](https://github.com/dotcom888/super-harness/releases)**

- **Windows 一键安装向导**：`super.harness.Setup.5.7.14.exe`
- **Windows 免安装绿色版**：`super.harness-5.7.14-win.zip`

---

## 🕹️ 常用命令与交互指南

在控制台中输入 `/` 或通过桌面端快速切换：

| 指令 / 模式 | 说明 |
| :--- | :--- |
| **`/status`**, **`/memory`** | 实时查看当前工作区感知状态、已读/已改文件、MCP 挂载服务与当前 Token 预算阶梯 |
| **`Auto 模式`** | 全自动模式：安全操作全自动免审批，高危命令阻断 |
| **`Plan 模式`** | 规划先行模式：像资深架构师一样先调研、出方案，审批后就地落地，循环内无感闭环 |
| **`Edit 模式`** | 代码免审模式：文件创建与补丁修改免确认，终端破坏性命令依然拦截 |
| **`Ask 模式`** | 全量审批模式：每一步工具与操作均弹窗由用户决策确认 |
| **`/undo`** | **物理级无损撤销**：不仅回退上一轮会话历史，同时还原磁盘被改动的文件 |
| **`/skills`** | 列出当前已挂载的所有专家技能包（包括内置技能与自定义技能） |
| **`/remember <偏好>`** | 永久记录一条个人编码偏好或习惯，跨项目永久生效 |
| **`/profile`** | 查看保存在用户主目录的全局画像与已登记项目索引 |

---

## 📄 开源许可证
本项目基于 [MIT License](LICENSE) 开源，商业友好，可自由二次开发与深度集成。
