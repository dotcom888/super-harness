import React, { useState, useEffect, useMemo } from "react";
import { 
  ChevronDown, 
  ChevronRight, 
  ChevronUp,
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ShieldCheck, 
  RotateCcw, 
  Download, 
  Info, 
  Activity, 
  Check, 
  Copy,
  Sparkles,
  Zap,
  Clock,
  Layers,
  MessageSquare,
  Wrench,
  CheckCheck
} from "lucide-react";
import { 
  TrajectoryStep, 
  ToolAction, 
  TurnData, 
  TrajectoryEvalReport, 
  TurnEvalItem,
  TrajectoryMetric, 
  TrajectoryDiagnostic, 
  TrajectoryStepAnnotation 
} from "../types";

interface TrajectoryTimelineProps {
  steps?: TrajectoryStep[];
  turns?: TurnData[];
  rawActions?: ToolAction[];
  thoughtText?: string;
  onOpenFile?: (path: string) => void;
  projectName?: string;
  sessionId?: string;
}

// 格式化工具入参（LLM 的工具调用请求）
function formatArgs(args?: Record<string, any> | string, desc?: string): string {
  if (!args && !desc) return "";
  if (typeof args === "string") return args;
  if (args && typeof args === "object") {
    if (args.raw) return String(args.raw);
    try {
      return JSON.stringify(args);
    } catch {
      return desc || "";
    }
  }
  return desc || "";
}

// 格式化工具执行输出预览（工具执行结果）
function formatOutputPreview(output?: string, status?: string): string {
  if (status === "running") return "正在执行...";
  if (!output) return "执行完成";
  const clean = output.replace(/\r?\n/g, " ").trim();
  return clean.length > 130 ? clean.slice(0, 127) + "..." : clean;
}

// 规范化单轮步骤数据
function getTurnSteps(turn: TurnData): TrajectoryStep[] {
  if (turn.steps && turn.steps.length > 0) {
    return turn.steps;
  }
  const collected: TrajectoryStep[] = [];
  if (turn.thought) {
    collected.push({
      id: `th_${turn.turn_id}`,
      type: "assistant",
      thought: turn.thought,
      timestamp: turn.timestamp || Date.now()
    });
  }
  for (const act of turn.actions || []) {
    collected.push({
      id: act.id,
      type: "tool",
      tool: act.tool,
      display: act.display,
      desc: act.desc,
      path: act.path,
      args: act.args,
      output: act.output,
      status: act.status,
      elapsed: act.elapsed,
      timestamp: act.timestamp
    });
  }
  return collected;
}

// 本地即时计算离线评测报告（包含全会话及逐轮次微观评测）
function computeLocalEvalReport(
  turns: TurnData[] = [],
  projectName: string = "default",
  sessionId: string = "default"
): TrajectoryEvalReport {
  let totalToolCalls = 0;
  let toolErrors = 0;
  let totalElapsed = 0;
  let allTasks = turns.flatMap((t) => t.tasks || []);
  let allActions: ToolAction[] = [];
  let criticScores: number[] = [];
  let selfHealingCount = 0;

  for (const t of turns) {
    if (t.elapsed) totalElapsed += t.elapsed;
    if (t.actions) {
      allActions.push(...t.actions);
      totalToolCalls += t.actions.length;
      for (const act of t.actions) {
        const out = act.output || "";
        if (
          act.status === "error" ||
          out.includes("【执行状态: 退出码 1】") ||
          out.includes("Error:") ||
          out.includes("【安全拦截拒绝】")
        ) {
          toolErrors++;
        }
      }
    }
    if (t.critic) {
      if (t.critic.score) criticScores.push(Number(t.critic.score));
      if (t.critic.status === "rejected" || (t.critic.loop && t.critic.loop > 0)) {
        selfHealingCount++;
      }
    }
  }

  const successfulToolCalls = Math.max(0, totalToolCalls - toolErrors);
  const toolSuccessRate = totalToolCalls > 0 ? Number(((successfulToolCalls / totalToolCalls) * 100).toFixed(1)) : 100.0;

  // 冗余调用检测
  let redundantCount = 0;
  const seenReadPaths = new Set<string>();
  const stepAnnotations: Record<string, TrajectoryStepAnnotation> = {};
  const redundantActionIds = new Set<string>();

  for (const act of allActions) {
    const tName = (act.tool || "").toLowerCase();
    const actId = act.id;
    let isRedundant = false;

    if (tName.includes("read") || tName.includes("cat") || tName.includes("view")) {
      const p = act.path || (act.args && typeof act.args === "object" ? act.args.path || act.args.file_path : "");
      if (p) {
        if (seenReadPaths.has(p)) {
          redundantCount++;
          isRedundant = true;
          redundantActionIds.add(actId);
        } else {
          seenReadPaths.add(p);
        }
      }
    }
    if (tName.includes("write") || tName.includes("patch") || tName.includes("edit")) {
      seenReadPaths.clear();
    }

    const out = act.output || "";
    const isErr = act.status === "error" || out.includes("【执行状态: 退出码 1】");

    stepAnnotations[actId] = {
      agent_role: "worker",
      diagnosis: isErr ? "工具执行异常" : (isRedundant ? "冗余重复探索" : "执行正常"),
      badge_type: isErr ? "error" : (isRedundant ? "warning" : "success"),
      is_redundant: isRedundant
    };
  }

  const efficiencyScore = Math.max(0, 100 - redundantCount * 15);
  const totalTasks = allTasks.length;
  const completedTasks = allTasks.filter((t) => t.completed).length;
  const taskCompletionRate = totalTasks > 0 ? Number(((completedTasks / totalTasks) * 100).toFixed(1)) : 100.0;
  const avgCriticScore = criticScores.length > 0 ? Number((criticScores.reduce((a, b) => a + b, 0) / criticScores.length).toFixed(1)) : 5.0;

  // 估算 Token
  let totalChars = 0;
  for (const t of turns) {
    totalChars += (t.user_prompt || "").length + (t.assistant_response || "").length + (t.thought || "").length;
    for (const a of t.actions || []) {
      totalChars += JSON.stringify(a.args || "").length + (a.output || "").length;
    }
  }
  const estTotalTokens = Math.max(120, Math.round(totalChars / 2.8));
  const estPromptTokens = Math.round(estTotalTokens * 0.72);
  const estCompletionTokens = Math.max(20, estTotalTokens - estPromptTokens);

  // 全会话健康分
  let healthScore = 100.0;
  healthScore -= toolErrors * 10.0;
  healthScore -= redundantCount * 5.0;
  if (totalTasks > 0 && taskCompletionRate < 100) {
    healthScore -= (100 - taskCompletionRate) * 0.35;
  }
  if (avgCriticScore < 4.5) {
    healthScore -= (4.5 - avgCriticScore) * 12.0;
  }
  if (selfHealingCount > 0) {
    healthScore += 5.0;
  }
  healthScore = Number(Math.min(100.0, Math.max(20.0, healthScore)).toFixed(1));

  let healthLevel: "A+" | "A" | "B" | "C" = "C";
  if (healthScore >= 95.0) healthLevel = "A+";
  else if (healthScore >= 85.0) healthLevel = "A";
  else if (healthScore >= 70.0) healthLevel = "B";

  // 逐轮次微观评测计算
  const turnsEval: TurnEvalItem[] = turns.map((t, idx) => {
    const tid = t.turn_id || idx + 1;
    const uPrompt = t.user_prompt || "";
    const tActions = t.actions || [];
    const tTasks = t.tasks || [];
    const tCritic = t.critic;
    const tElapsed = t.elapsed || 0;

    let tToolErrors = 0;
    let tRedundant = 0;
    const tStepIds: string[] = [];

    for (const act of tActions) {
      if (act.id) tStepIds.push(act.id);
      const out = act.output || "";
      if (act.status === "error" || out.includes("【执行状态: 退出码 1】")) {
        tToolErrors++;
      }
      if (redundantActionIds.has(act.id)) {
        tRedundant++;
      }
    }

    const tToolCalls = tActions.length;
    const tSuccessRate = tToolCalls > 0 ? Number((((tToolCalls - tToolErrors) / tToolCalls) * 100).toFixed(1)) : 100.0;
    const tTotalTasks = tTasks.length;
    const tCompTasks = tTasks.filter((x) => x.completed).length;
    const tTaskRate = tTotalTasks > 0 ? Number(((tCompTasks / tTotalTasks) * 100).toFixed(1)) : 100.0;

    let cScoreVal: number | null = null;
    let cScoreStr = "未触发";
    let cStatus = "none";
    let cReason = "";
    if (tCritic) {
      cStatus = tCritic.status || "none";
      if (tCritic.score !== undefined) {
        cScoreVal = Number(tCritic.score);
        cScoreStr = `${cScoreVal.toFixed(1)} / 5.0`;
      }
      cReason = tCritic.reason || "";
    }

    let tChars = uPrompt.length + (t.assistant_response || "").length + (t.thought || "").length;
    for (const act of tActions) {
      tChars += JSON.stringify(act.args || "").length + (act.output || "").length;
    }
    const tTokens = Math.max(50, Math.round(tChars / 2.8));

    let tHealth = 100.0;
    tHealth -= tToolErrors * 15.0;
    tHealth -= tRedundant * 8.0;
    if (tTotalTasks > 0 && tTaskRate < 100) {
      tHealth -= (100 - tTaskRate) * 0.35;
    }
    if (cScoreVal !== null && cScoreVal < 4.5) {
      tHealth -= (4.5 - cScoreVal) * 15.0;
    }
    if (cStatus === "rejected") {
      tHealth -= 10.0;
    }
    tHealth = Number(Math.min(100.0, Math.max(20.0, tHealth)).toFixed(1));

    let tLevel: "A+" | "A" | "B" | "C" = "C";
    if (tHealth >= 95.0) tLevel = "A+";
    else if (tHealth >= 85.0) tLevel = "A";
    else if (tHealth >= 70.0) tLevel = "B";

    let tSummary = "";
    if (tToolCalls === 0) {
      tSummary = "本轮为即时问答直达交付，认知模型纯文本完成输出，无物理工具副作用。";
    } else if (tToolErrors === 0 && tRedundant === 0) {
      if (cStatus === "passed") {
        tSummary = `规划任务闭环率 ${tTaskRate}%，工具 ${tToolCalls}/${tToolCalls} 步正常，在线质量审查通过。`;
      } else {
        tSummary = `工具调用 ${tToolCalls} 步全部成功，无冗余探索，交付成果完整。`;
      }
    } else {
      const issues: string[] = [];
      if (tToolErrors > 0) issues.push(`${tToolErrors} 次工具报错`);
      if (tRedundant > 0) issues.push(`${tRedundant} 次冗余读`);
      tSummary = `检测到 ${issues.join("，")}，已触发相应容错与自愈机制。`;
    }

    return {
      turn_id: tid,
      user_prompt: uPrompt.length > 80 ? uPrompt.slice(0, 80) + "..." : uPrompt,
      health_score: tHealth,
      health_level: tLevel,
      tool_calls_count: tToolCalls,
      tool_errors_count: tToolErrors,
      tool_success_rate: `${tSuccessRate}%`,
      redundant_calls_count: tRedundant,
      elapsed: `${Number(tElapsed.toFixed(1))}s`,
      tokens: tTokens,
      task_completion_rate: `${tTaskRate}%`,
      critic_score: cScoreStr,
      critic_status: cStatus,
      critic_reason: cReason,
      turn_summary: tSummary,
      step_ids: tStepIds
    };
  });

  const diagnostics: TrajectoryDiagnostic[] = [];
  if (totalTasks > 0) {
    if (taskCompletionRate >= 100.0) {
      diagnostics.push({
        type: "pass",
        title: "任务清单全量达成",
        detail: `规划的 ${totalTasks} 项分解任务均已按序推进并 100% 闭环落地。`
      });
    } else {
      diagnostics.push({
        type: "warning",
        title: "部分任务推进中",
        detail: `共规划 ${totalTasks} 项任务，已达成 ${completedTasks} 项 (${taskCompletionRate}%)。`
      });
    }
  } else {
    diagnostics.push({
      type: "info",
      title: "即时响应直达交付",
      detail: "本会话无需复杂工程拆解，由 Planner 智能旁路，免除多余规划开销。"
    });
  }

  if (totalToolCalls > 0) {
    if (toolErrors === 0) {
      diagnostics.push({
        type: "pass",
        title: "工具执行零报错",
        detail: `全链路共执行 ${totalToolCalls} 次工具调用，成功率达 100.0%，无退出码异常与安全拦截。`
      });
    } else {
      diagnostics.push({
        type: "warning",
        title: "存在工具调用异常",
        detail: `共调用 ${totalToolCalls} 次工具，其中 ${toolErrors} 次执行异常或退出码非零。`
      });
    }
  } else {
    diagnostics.push({
      type: "info",
      title: "纯认知生成无物理工具",
      detail: "全链路未调用底层物理工具，由大模型纯文本直接完成交付。"
    });
  }

  if (redundantCount === 0) {
    diagnostics.push({
      type: "pass",
      title: "探索收敛路径优异",
      detail: `探索有效率评分 ${efficiencyScore} 分，无重复读文件与同构探测冗余。`
    });
  } else {
    diagnostics.push({
      type: "warning",
      title: "检测到重复探索",
      detail: `发现 ${redundantCount} 次重复读操作，已扣除探索效率分。`
    });
  }

  if (criticScores.length > 0) {
    diagnostics.push({
      type: "pass",
      title: "后置审查合格验收",
      detail: `Critic 综合质检评分 ${avgCriticScore} / 5.0，符合生产级交付标准。`
    });
  }

  const metricCards: TrajectoryMetric[] = [
    {
      label: "执行成功率",
      value: `${toolSuccessRate}%`,
      sub: totalToolCalls > 0 ? `${successfulToolCalls}/${totalToolCalls} 步正常` : "纯对话零异常",
      status: toolSuccessRate >= 95 ? "good" : (toolSuccessRate >= 80 ? "warning" : "error")
    },
    {
      label: "探索有效率",
      value: `${efficiencyScore}分`,
      sub: redundantCount > 0 ? `${redundantCount} 次冗余探索` : "0 冗余调用 · 高度收敛",
      status: efficiencyScore >= 85 ? "good" : "warning"
    },
    {
      label: "资源与耗时",
      value: `${Number(totalElapsed.toFixed(1))}s`,
      sub: `约 ${estTotalTokens} tokens · ${turns.length} 轮对话`,
      status: totalElapsed < 60 ? "good" : "info"
    },
    {
      label: "规划达成率",
      value: `${taskCompletionRate}%`,
      sub: totalTasks > 0 ? `${completedTasks}/${totalTasks} 任务闭环` : `质检评分 ${avgCriticScore}/5.0`,
      status: taskCompletionRate >= 100 ? "good" : "warning"
    }
  ];

  return {
    session_id: sessionId,
    project: projectName,
    timestamp: Date.now() / 1000,
    health_score: healthScore,
    health_level: healthLevel,
    summary: `本会话共运行 ${turns.length} 轮次，累计执行 ${totalToolCalls} 次工具调用。任务规划达成率 ${taskCompletionRate}%，工具调用成功率 ${toolSuccessRate}%，全链路健康得分 ${healthScore} / 100 (${healthLevel})。`,
    metrics: {
      tool_success_rate: `${toolSuccessRate}%`,
      tool_calls_count: totalToolCalls,
      tool_errors_count: toolErrors,
      efficiency_score: `${efficiencyScore}分`,
      redundant_calls_count: redundantCount,
      total_tokens: estTotalTokens,
      prompt_tokens: estPromptTokens,
      completion_tokens: estCompletionTokens,
      total_elapsed: `${Number(totalElapsed.toFixed(1))}s`,
      task_completion_rate: `${taskCompletionRate}%`,
      critic_pass_rate: `${avgCriticScore} / 5.0`,
      self_healing_count: selfHealingCount
    },
    metric_cards: metricCards,
    diagnostics,
    step_annotations: stepAnnotations,
    turns_eval: turnsEval
  };
}

export const TrajectoryTimeline: React.FC<TrajectoryTimelineProps> = ({
  steps,
  turns = [],
  rawActions,
  thoughtText,
  onOpenFile,
  projectName = "default",
  sessionId = "default"
}) => {
  // 全会话总览大看板显隐状态（可通过点击上边栏自由切换显示/隐藏）
  const [sessionBoardExpanded, setSessionBoardExpanded] = useState<boolean>(false);
  // 单轮时间线折叠状态字典（默认展开）
  const [collapsedTurnsMap, setCollapsedTurnsMap] = useState<Record<number, boolean>>({});
  // 单个步骤 IN/OUT 展开字典
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState<boolean>(true);
  const [evalReport, setEvalReport] = useState<TrajectoryEvalReport | null>(() => {
    return computeLocalEvalReport(turns, projectName, sessionId);
  });
  const [evalLoading, setEvalLoading] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // 加载服务端离线轨迹评测数据
  const fetchEvalReport = (forceRefresh: boolean = false) => {
    setEvalLoading(true);
    fetch(`http://127.0.0.1:8765/api/eval/trajectory?project=${encodeURIComponent(projectName)}&session_id=${encodeURIComponent(sessionId)}&force_refresh=${forceRefresh}`)
      .then((res) => {
        if (!res.ok) throw new Error("Eval API not available");
        return res.json();
      })
      .then((data: TrajectoryEvalReport) => {
        if (data && data.health_score !== undefined) {
          setEvalReport(data);
        }
      })
      .catch(() => {
        setEvalReport(computeLocalEvalReport(turns, projectName, sessionId));
      })
      .finally(() => {
        setEvalLoading(false);
      });
  };

  useEffect(() => {
    fetchEvalReport(false);
  }, [projectName, sessionId, turns?.length]);

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTurnCollapse = (turnId: number) => {
    setCollapsedTurnsMap((prev) => ({ ...prev, [turnId]: !prev[turnId] }));
  };

  // 导出评测报告为 Markdown 文件
  const handleExportMarkdown = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!evalReport) return;
    const md = [
      `# Super-Harness 智能体执行轨迹离线评测报告`,
      `- **会话标识**: \`${evalReport.session_id}\``,
      `- **所属工程**: \`${evalReport.project}\``,
      `- **健康度总评分**: **${evalReport.health_score} / 100 (${evalReport.health_level})**`,
      `- **生成时间**: ${new Date(evalReport.timestamp * 1000).toLocaleString()}`,
      ``,
      `## 一、全会话宏观指标看板`,
      `- **工具调用成功率**: ${evalReport.metrics.tool_success_rate} (成功 ${evalReport.metrics.tool_calls_count - evalReport.metrics.tool_errors_count}/${evalReport.metrics.tool_calls_count} 步)`,
      `- **探索有效率评分**: ${evalReport.metrics.efficiency_score} (冗余调用 ${evalReport.metrics.redundant_calls_count} 次)`,
      `- **资源与能效统计**: 估算消耗 ${evalReport.metrics.total_tokens} tokens · 总耗时 ${evalReport.metrics.total_elapsed}`,
      `- **任务规划达成率**: ${evalReport.metrics.task_completion_rate}`,
      `- **质量审查综合分**: ${evalReport.metrics.critic_pass_rate} (自愈反思 ${evalReport.metrics.self_healing_count} 次)`,
      ``,
      `## 二、逐轮次 (Turn-by-Turn) 质检明细`,
      ...(evalReport.turns_eval || []).map((t) => [
        `### Turn ${t.turn_id}: "${t.user_prompt}"`,
        `- **单轮健康评分**: ${t.health_score} / 100 (${t.health_level})`,
        `- **工具调用表现**: 成功率 ${t.tool_success_rate} (${t.tool_calls_count} 步，${t.tool_errors_count} 报错，${t.redundant_calls_count} 冗余)`,
        `- **资源与耗时**: 耗时 ${t.elapsed} · 消耗约 ${t.tokens} tokens`,
        `- **任务达成度**: ${t.task_completion_rate}`,
        `- **质检审查**: ${t.critic_score} (${t.critic_status === 'passed' ? '已通过' : (t.critic_status === 'rejected' ? '已驳回' : '未触发')})`,
        `- **质检小结**: ${t.turn_summary}`,
        ``
      ].join("\n")),
      `## 三、质检诊断发现与调优建议`,
      ...evalReport.diagnostics.map((d) => `- [${d.type.toUpperCase()}] **${d.title}**: ${d.detail}`),
      ``,
      `## 四、评测总结`,
      evalReport.summary,
      ``,
      `---`,
      `*本报告由 Super-Harness Multi-Agent 离线轨迹质检系统自动生成并归档。*`
    ].join("\n");

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trajectory_eval_${sessionId || "session"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // 构建逐轮次分组数据
  const turnGroups = useMemo(() => {
    if (turns && turns.length > 0) {
      return turns.map((t, idx) => {
        const tid = t.turn_id || idx + 1;
        const turnSteps = getTurnSteps(t);
        const evalItem = evalReport?.turns_eval?.find((e) => e.turn_id === tid);
        return {
          turn: t,
          turnId: tid,
          steps: turnSteps,
          evalItem
        };
      });
    }

    // 兜底：若暂未形成完整 turns，合成单轮数据
    if (steps && steps.length > 0) {
      return [{
        turn: { turn_id: 1, user_prompt: "执行任务", actions: rawActions || [] } as TurnData,
        turnId: 1,
        steps: steps,
        evalItem: evalReport?.turns_eval?.[0]
      }];
    }

    return [];
  }, [turns, steps, rawActions, thoughtText, evalReport]);

  const totalAllSteps = turnGroups.reduce((acc, g) => acc + g.steps.length, 0);

  return (
    <div className="max-w-4xl w-full mx-auto py-2 space-y-4">
      {/* 1. 顶部：全会话宏观评测总览卡片（可收起/展开，点击上边栏显隐） */}
      {evalReport && (
        <div className="rounded-2xl border border-gray-200/90 dark:border-gray-800 bg-white dark:bg-[#161820] shadow-2xs select-text overflow-hidden transition-all duration-200">
          {/* 上边栏 (点击可自由显示与隐藏下方完整大看板) */}
          <div
            onClick={() => setSessionBoardExpanded(!sessionBoardExpanded)}
            className="px-4 py-3 sm:px-5 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-gray-50/70 dark:hover:bg-[#1b1e28] transition group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <ShieldCheck size={18} />
              </div>
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-xs font-bold text-gray-900 dark:text-gray-100 font-sans tracking-tight">
                  全会话质检总览
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                    evalReport.health_score >= 85
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60"
                      : "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800/60"
                  }`}
                >
                  健康分 {evalReport.health_score} / 100 ({evalReport.health_level})
                </span>
                <span className="text-gray-400 dark:text-gray-500 text-[11px] font-sans hidden sm:inline">
                  · 共 {turns.length} 轮对话
                </span>
                {/* 常驻微型指标胶囊 */}
                <div className="hidden md:flex items-center gap-1.5 text-[10px] text-gray-500 font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#20232e] border border-gray-200/70 dark:border-gray-800">
                    成功率 {evalReport.metrics.tool_success_rate}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#20232e] border border-gray-200/70 dark:border-gray-800">
                    冗余 {evalReport.metrics.redundant_calls_count}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#20232e] border border-gray-200/70 dark:border-gray-800">
                    {evalReport.metrics.total_elapsed}
                  </span>
                </div>
              </div>
            </div>

            {/* 右侧操作与折叠状态 */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchEvalReport(true);
                }}
                disabled={evalLoading}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200/90 dark:bg-[#20232e] dark:hover:bg-[#282c3a] text-gray-700 dark:text-gray-200 border border-gray-200/80 dark:border-gray-700/80 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="重新触发全链路离线质检"
              >
                <RotateCcw size={11} className={evalLoading ? "animate-spin text-blue-500" : ""} />
                <span className="hidden sm:inline">{evalLoading ? "体检中..." : "重新体检"}</span>
              </button>

              <button
                type="button"
                onClick={handleExportMarkdown}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 hover:bg-blue-100/90 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/80 transition flex items-center gap-1.5 cursor-pointer"
                title="导出标准化 Markdown 评测报告"
              >
                {copiedReport ? <Check size={11} className="text-emerald-600" /> : <Download size={11} />}
                <span className="hidden sm:inline">{copiedReport ? "已导出" : "导出报告"}</span>
              </button>

              <div className="flex items-center gap-1 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition text-xs font-medium pl-1">
                <span className="text-[11px] hidden sm:inline">
                  {sessionBoardExpanded ? "收起看板" : "展开全会话看板"}
                </span>
                {sessionBoardExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </div>
            </div>
          </div>

          {/* 展开的全量大看板 (指标卡片 + 诊断清单) */}
          {sessionBoardExpanded && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-2 border-t border-gray-100 dark:border-gray-800/80 space-y-3.5 animate-in fade-in duration-150">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-sans leading-relaxed">
                {evalReport.summary}
              </p>

              {/* 四大核心量化指标卡片 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {evalReport.metric_cards.map((card, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-gray-50/80 dark:bg-[#1c1f2b] border border-gray-200/60 dark:border-gray-800/80 flex flex-col justify-between"
                  >
                    <span className="text-gray-500 dark:text-gray-400 text-[11px] font-sans">
                      {card.label}
                    </span>
                    <div className="my-1">
                      <span
                        className={`text-lg font-bold font-mono ${
                          card.status === "good"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : card.status === "warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {card.value}
                      </span>
                    </div>
                    {card.sub && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate font-mono" title={card.sub}>
                        {card.sub}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* 质检诊断清单 */}
              {evalReport.diagnostics && evalReport.diagnostics.length > 0 && (
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800/80">
                  <button
                    type="button"
                    onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 font-medium select-none mb-2 cursor-pointer"
                  >
                    <span>全链路质检诊断发现 ({evalReport.diagnostics.length} 项)</span>
                    {diagnosticsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>

                  {diagnosticsExpanded && (
                    <div className="space-y-1.5 animate-in fade-in duration-100">
                      {evalReport.diagnostics.map((diag, dIdx) => (
                        <div
                          key={dIdx}
                          className="flex items-start gap-2 p-2 rounded-lg bg-gray-50/60 dark:bg-[#1a1d27] border border-gray-100 dark:border-gray-800/60 text-xs"
                        >
                          {diag.type === "pass" ? (
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                          ) : diag.type === "warning" ? (
                            <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                          ) : (
                            <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-800 dark:text-gray-200 mr-1.5">
                              {diag.title}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400 leading-relaxed font-sans">
                              {diag.detail}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. 主体区：逐轮次 (Turn-by-Turn) 质检总结卡片与调用流 */}
      <div className="flex items-center justify-between px-1 text-xs text-gray-400 font-mono select-none">
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-blue-500" />
          <span className="font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
            逐轮次执行轨迹与微观评测明细
          </span>
        </div>
        <span>共 {turnGroups.length} 轮 · 累计 {totalAllSteps} 个步骤</span>
      </div>

      {turnGroups.length === 0 ? (
        <div className="py-12 text-center text-xs text-gray-400 select-none bg-gray-50/50 dark:bg-[#161820] rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
          当前会话暂无执行轨迹，请在对话框发起提问
        </div>
      ) : (
        <div className="space-y-4">
          {turnGroups.map((group) => {
            const { turn, turnId, steps: turnSteps, evalItem } = group;
            const isTurnCollapsed = Boolean(collapsedTurnsMap[turnId]);

            return (
              <div 
                key={turnId}
                id={`turn-trajectory-${turnId}`}
                className="rounded-2xl border border-gray-200/90 dark:border-gray-800 bg-white dark:bg-[#161820] shadow-2xs overflow-hidden select-text scroll-mt-6"
              >
                {/* 轮次质检标头 (Turn Eval Header) */}
                <div 
                  onClick={() => toggleTurnCollapse(turnId)}
                  className="px-4 py-3 sm:px-5 bg-gray-50/60 dark:bg-[#191c26] border-b border-gray-100 dark:border-gray-800/80 cursor-pointer select-none hover:bg-gray-100/60 dark:hover:bg-[#1e2230] transition group"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    {/* 左侧：Turn 编号 + 用户提问 */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-blue-100/80 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                        Turn {turnId}
                      </span>
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate max-w-md sm:max-w-xl font-sans" title={turn.user_prompt}>
                        {turn.user_prompt || "执行指令"}
                      </span>
                    </div>

                    {/* 右侧：单轮健康分 + 展开/折叠 */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                      {evalItem && (
                        <span 
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            evalItem.health_score >= 85
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60"
                              : "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800/60"
                          }`}
                        >
                          单轮健康分 {evalItem.health_score} ({evalItem.health_level})
                        </span>
                      )}
                      <div className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition">
                        {isTurnCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      </div>
                    </div>
                  </div>

                  {/* 单轮评测指标条 + 质检小结 */}
                  {evalItem && (
                    <div className="mt-2 pt-2 border-t border-gray-200/50 dark:border-gray-800/50 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      {/* 指标标签 */}
                      <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-gray-500 dark:text-gray-400">
                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#14161e] border border-gray-200/80 dark:border-gray-800">
                          耗时 {evalItem.elapsed}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#14161e] border border-gray-200/80 dark:border-gray-800">
                          工具 {evalItem.tool_calls_count - evalItem.tool_errors_count}/{evalItem.tool_calls_count} 正常
                        </span>
                        {evalItem.redundant_calls_count > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300">
                            冗余 {evalItem.redundant_calls_count}
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#14161e] border border-gray-200/80 dark:border-gray-800">
                          约 {evalItem.tokens} tokens
                        </span>
                        {evalItem.critic_score && evalItem.critic_score !== "未触发" && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300">
                            质检 {evalItem.critic_score}
                          </span>
                        )}
                      </div>

                      {/* 单轮小结 */}
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 font-sans italic">
                        {evalItem.turn_summary}
                      </div>
                    </div>
                  )}
                </div>

                {/* 单轮时间线调用流 */}
                {!isTurnCollapsed && (
                  <div className="p-4 sm:p-5">
                    {turnSteps.length === 0 ? (
                      <div className="py-4 text-center text-xs text-gray-400 select-none">
                        本轮为即时生成，无底层工具调用步骤
                      </div>
                    ) : (
                      <div className="relative pl-7 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-px before:bg-gray-200 dark:before:bg-gray-800 space-y-4">
                        {turnSteps.map((step, idx) => {
                          const stepId = step.id || `step_${turnId}_${idx}`;
                          const isExpanded = Boolean(expandedMap[stepId]);
                          const isTool = step.type === "tool";
                          const annotation = evalReport?.step_annotations?.[stepId];

                          return (
                            <div key={stepId} className="relative group text-xs select-text">
                              {/* 时间线节点小圆点 */}
                              <div
                                className={`w-2 h-2 rounded-full absolute left-[-18px] top-2 -translate-x-1/2 ring-4 ring-white dark:ring-[#0f1117] transition ${
                                  annotation?.badge_type === "error"
                                    ? "bg-red-500"
                                    : annotation?.badge_type === "warning"
                                    ? "bg-amber-500"
                                    : "bg-gray-400 dark:bg-gray-600 group-hover:bg-blue-500"
                                }`}
                              />

                              {isTool ? (
                                /* TOOL 节点 */
                                <div className="bg-white dark:bg-[#1a1c24] border border-gray-200/80 dark:border-gray-800 rounded-xl p-2.5 shadow-2xs hover:border-gray-300 dark:hover:border-gray-700 transition">
                                  <div
                                    onClick={() => toggleExpand(stepId)}
                                    className="flex items-start gap-2.5 cursor-pointer"
                                  >
                                    <span className="relative w-11 h-[18px] flex items-center justify-center shrink-0 mt-0.5 select-none">
                                      <span className="px-2 py-0.5 text-[10px] font-bold font-mono tracking-wider text-[#b45309] bg-[#fef3c7] dark:bg-[#38260b] dark:text-[#fcd34d] border border-[#fde68a] dark:border-[#78350f] rounded group-hover:hidden">
                                        TOOL
                                      </span>
                                      <span className="hidden group-hover:flex items-center justify-center text-gray-500 dark:text-gray-400">
                                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                      </span>
                                    </span>

                                    <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap font-mono text-[11px]">
                                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200/60 select-none">
                                        WORKER
                                      </span>

                                      {annotation?.badge_type === "warning" && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 select-none">
                                          ⚠️ 冗余调用
                                        </span>
                                      )}
                                      {annotation?.badge_type === "error" && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-red-100 text-red-700 border border-red-300 dark:bg-red-950/60 dark:text-red-300 select-none">
                                          ❌ 异常报错
                                        </span>
                                      )}

                                      <span className="font-bold text-gray-900 dark:text-gray-100">
                                        {step.tool || step.display || "tool"}
                                      </span>

                                      <span
                                        className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-[#222530] border border-gray-200/70 dark:border-gray-700/80 px-1.5 py-0.5 rounded truncate max-w-md font-mono"
                                        title={formatArgs(step.args, step.desc)}
                                      >
                                        {formatArgs(step.args, step.desc) || "{}"}
                                      </span>

                                      <span className="text-gray-400 font-bold select-none">→</span>

                                      <span
                                        className={`truncate max-w-lg font-mono ${
                                          step.status === "error" ? "text-red-500 font-semibold" : "text-gray-500 dark:text-gray-400"
                                        }`}
                                        title={step.output}
                                      >
                                        {formatOutputPreview(step.output, step.status)}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 text-gray-400 text-[10px] shrink-0 font-mono ml-auto select-none">
                                      {step.elapsed !== undefined && <span>{step.elapsed}s</span>}
                                      {step.status === "running" && <Loader2 size={12} className="animate-spin text-amber-500" />}
                                    </div>
                                  </div>

                                  {isExpanded && (
                                    <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800 font-mono text-[11px] space-y-2.5 animate-in fade-in duration-100">
                                      {step.args && (
                                        <div>
                                          <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                            <span>IN</span>
                                            <span className="text-gray-400 font-normal">LLM 的工具调用请求参数</span>
                                          </div>
                                          <pre className="p-2.5 bg-gray-50 dark:bg-[#1e202a] border border-gray-200/80 dark:border-gray-700/80 rounded-lg text-gray-800 dark:text-gray-200 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed select-text">
                                            {typeof step.args === "object" ? JSON.stringify(step.args, null, 2) : step.args}
                                          </pre>
                                        </div>
                                      )}

                                      {step.output && (
                                        <div>
                                          <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                            <span>OUT</span>
                                            <span className="text-gray-400 font-normal">底层物理工具执行返回结果</span>
                                          </div>
                                          <pre className="p-2.5 bg-gray-50 dark:bg-[#1e202a] border border-gray-200/80 dark:border-gray-700/80 rounded-lg text-gray-800 dark:text-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed select-text">
                                            {step.output}
                                          </pre>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                /* ASSISTANT 思考节点 */
                                <div className="bg-white dark:bg-[#1a1c24] border border-gray-200/80 dark:border-gray-800 rounded-xl p-2.5 shadow-2xs hover:border-gray-300 dark:hover:border-gray-700 transition">
                                  <div className="flex items-start gap-2.5">
                                    <span className="px-2 py-0.5 text-[10px] font-bold font-mono tracking-wider text-[#7c3aed] dark:text-[#c084fc] bg-[#f5f3ff] dark:bg-[#2e1d4d] border border-[#ddd6fe] dark:border-[#582b8c] rounded shrink-0 select-none mt-0.5">
                                      ASSISTANT
                                    </span>
                                    <div className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-relaxed font-sans select-text whitespace-pre-wrap break-words">
                                      {step.thought || step.content}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
