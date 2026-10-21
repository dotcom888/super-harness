export type ExecutionModeId = "auto" | "edit_auto" | "plan" | "manual";

export interface ExecutionModeOption {
  id: ExecutionModeId;
  name: string;
  badge: string;
  desc: string;
  iconName: "Zap" | "FileEdit" | "Compass" | "ShieldCheck";
}

export const EXECUTION_MODES: ExecutionModeOption[] = [
  {
    id: "auto",
    name: "Auto 模式",
    badge: "Auto",
    desc: "日常开发最推荐，效率与安全兼顾（安全改不问，危险跑才问）",
    iconName: "Zap"
  },
  {
    id: "edit_auto",
    name: "Edit automatically",
    badge: "Edit",
    desc: "适合明确目标、快速改代码（直接改不问，命令才问）",
    iconName: "FileEdit"
  },
  {
    id: "plan",
    name: "Plan 模式",
    badge: "Plan",
    desc: "适合大重构、复杂任务，先审批（不动手，先出方案）",
    iconName: "Compass"
  },
  {
    id: "manual",
    name: "Manual 模式",
    badge: "Manual",
    desc: "步步为营，最安全但最累（编辑文件与执行命令每次都问）",
    iconName: "ShieldCheck"
  }
];

export function normalizeModeId(mode?: string): ExecutionModeId {
  if (!mode) return "auto";
  const m = mode.trim().toLowerCase();
  if (m.includes("plan")) return "plan";
  if (m.includes("edit")) return "edit_auto";
  if (m.includes("manual") || m.includes("ask") || m.includes("always_ask")) return "manual";
  return "auto";
}

export function getModeDisplayName(mode?: string): string {
  const norm = normalizeModeId(mode);
  switch (norm) {
    case "edit_auto":
      return "Edit automatically";
    case "plan":
      return "Plan 模式";
    case "manual":
      return "Manual 模式";
    default:
      return "Auto 模式";
  }
}

export interface ModeVisualConfig {
  id: ExecutionModeId;
  gradientBorder: string;
  floatingShadow: string;
  focusGlow: string;
  accentColor: string;
}

export function getModeVisualConfig(mode?: string): ModeVisualConfig {
  const norm = normalizeModeId(mode);
  switch (norm) {
    case "edit_auto":
      return {
        id: "edit_auto",
        // 对角线渐变，未选中时轻透柔和，选中时自动饱满高亮
        gradientBorder: "from-emerald-500/40 via-teal-400/30 to-green-500/40 dark:from-emerald-400/50 dark:via-teal-300/35 dark:to-green-400/50",
        floatingShadow: "shadow-[0_4px_18px_rgba(16,185,129,0.08)] dark:shadow-[0_4px_20px_rgba(16,185,129,0.12)]",
        focusGlow: "focus-within:shadow-[0_8px_32px_rgba(16,185,129,0.22)] dark:focus-within:shadow-[0_10px_36px_rgba(16,185,129,0.30)]",
        accentColor: "text-emerald-500 dark:text-emerald-400",
      };
    case "plan":
      return {
        id: "plan",
        gradientBorder: "from-amber-500/45 via-orange-400/30 to-yellow-500/45 dark:from-amber-400/55 dark:via-orange-400/40 dark:to-yellow-400/55",
        floatingShadow: "shadow-[0_4px_18px_rgba(245,158,11,0.09)] dark:shadow-[0_4px_20px_rgba(245,158,11,0.13)]",
        focusGlow: "focus-within:shadow-[0_8px_32px_rgba(245,158,11,0.24)] dark:focus-within:shadow-[0_10px_36px_rgba(245,158,11,0.32)]",
        accentColor: "text-amber-500 dark:text-amber-400",
      };
    case "manual":
      return {
        id: "manual",
        gradientBorder: "from-purple-500/40 via-violet-400/30 to-fuchsia-500/40 dark:from-purple-400/50 dark:via-violet-400/35 dark:to-fuchsia-400/50",
        floatingShadow: "shadow-[0_4px_18px_rgba(168,85,247,0.08)] dark:shadow-[0_4px_20px_rgba(168,85,247,0.12)]",
        focusGlow: "focus-within:shadow-[0_8px_32px_rgba(168,85,247,0.22)] dark:focus-within:shadow-[0_10px_36px_rgba(168,85,247,0.30)]",
        accentColor: "text-purple-500 dark:text-purple-400",
      };
    case "auto":
    default:
      return {
        id: "auto",
        gradientBorder: "from-blue-500/40 via-indigo-400/30 to-cyan-500/40 dark:from-blue-400/50 dark:via-indigo-400/35 dark:to-cyan-400/50",
        floatingShadow: "shadow-[0_4px_18px_rgba(59,130,246,0.08)] dark:shadow-[0_4px_20px_rgba(59,130,246,0.12)]",
        focusGlow: "focus-within:shadow-[0_8px_32px_rgba(59,130,246,0.22)] dark:focus-within:shadow-[0_10px_36px_rgba(59,130,246,0.30)]",
        accentColor: "text-blue-500 dark:text-blue-400",
      };
  }
}

