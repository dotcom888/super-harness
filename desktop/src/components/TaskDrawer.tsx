import React, { useState } from "react";
import { CheckSquare, ChevronUp, ChevronDown, Check, Circle } from "lucide-react";
import { TaskItem } from "../types";

interface TaskDrawerProps {
  tasks: TaskItem[];
  isLoading?: boolean;
  defaultOpen?: boolean;
}

export const TaskDrawer: React.FC<TaskDrawerProps> = ({
  tasks,
  isLoading = false,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  if (!tasks || tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.completed).length;
  const isAllCompleted = completedCount === tasks.length && tasks.length > 0;

  // 当前正在执行的任务项（第一个未完成的项）
  const activeTaskIndex = tasks.findIndex((t) => !t.completed);
  const activeTask = activeTaskIndex >= 0 ? tasks[activeTaskIndex] : null;

  return (
    <div className="w-full transition-all duration-200 select-none">
      {/* 默认紧凑单行卡片 / 展开时的头部 (左右宽度与输入框严格对齐，垂直高度紧凑至原80%) */}
      <div
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-3 py-1.5 bg-white/95 dark:bg-[#1a1d27]/95 backdrop-blur-md border rounded-xl cursor-pointer transition-all duration-200 shadow-2xs ${
          open
            ? "border-blue-400 dark:border-blue-500 rounded-b-none"
            : "border-gray-200/90 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-600"
        }`}
      >
        {/* 左侧：当前执行任务摘要 */}
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2.5">
          {isAllCompleted ? (
            <div className="p-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckSquare size={13} />
            </div>
          ) : (
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
              {isLoading && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              )}
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-600 dark:bg-blue-400"></span>
            </span>
          )}

          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-semibold text-[11.5px] text-gray-800 dark:text-gray-200 shrink-0">
              {open ? "本轮任务规划:" : "当前任务:"}
            </span>
            <span
              className={`text-[11.5px] truncate leading-tight ${
                isAllCompleted
                  ? "text-emerald-700 dark:text-emerald-300 font-medium"
                  : "text-blue-700 dark:text-blue-300 font-medium"
              }`}
            >
              {isAllCompleted
                ? "全部规划任务已执行完成"
                : activeTask
                ? activeTask.title
                : "所有任务准备就绪"}
            </span>
          </div>
        </div>

        {/* 右侧：进度显示与展开折叠 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-mono font-medium ${
              isAllCompleted
                ? "bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                : "bg-blue-100/70 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
            }`}
          >
            {completedCount}/{tasks.length}
          </span>
          <div className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex items-center">
            {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </div>
        </div>
      </div>

      {/* 点击展开后的任务完整详情清单 (上下高度与间距缩小至80%) */}
      {open && (
        <div className="w-full p-2 bg-white dark:bg-[#171922] border-x border-b border-blue-400 dark:border-blue-500 rounded-b-xl shadow-md space-y-1 text-xs max-h-52 overflow-y-auto">
          {tasks.map((task, idx) => {
            const isActive = idx === activeTaskIndex && !isAllCompleted;
            return (
              <div
                key={task.id || `task_${idx}`}
                className={`flex items-center gap-2 px-2 py-1 rounded-md transition-all duration-200 ${
                  isActive
                    ? "bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/50"
                    : "hover:bg-gray-50 dark:hover:bg-[#1f222e]"
                }`}
              >
                {task.completed ? (
                  <span className="w-3.5 h-3.5 rounded bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <Check size={10} strokeWidth={3} />
                  </span>
                ) : isActive ? (
                  <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-600 dark:bg-blue-400"></span>
                  </span>
                ) : (
                  <Circle size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                )}

                <span
                  className={`flex-1 text-[11.5px] leading-tight transition-all duration-200 truncate ${
                    task.completed
                      ? "line-through text-gray-400 dark:text-gray-500 opacity-60 font-normal"
                      : isActive
                      ? "text-blue-700 dark:text-blue-300 font-medium"
                      : "text-gray-700 dark:text-gray-300 font-normal"
                  }`}
                >
                  {task.title}
                </span>

                {isActive && (
                  <span className="text-[10px] text-blue-500 dark:text-blue-400 animate-pulse font-mono shrink-0">
                    执行中
                  </span>
                )}
                {task.completed && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono shrink-0 opacity-70">
                    已完成
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
