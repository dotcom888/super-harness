import React, { useState } from "react";
import { TurnData } from "../types";

interface TurnRulerProps {
  turns: TurnData[];
  onScrollToTurn: (turnId: number) => void;
  activeTurnId?: number | null;
}

export const TurnRuler: React.FC<TurnRulerProps> = ({ turns, onScrollToTurn, activeTurnId }) => {
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);

  if (!turns || turns.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1.5 py-3 select-none pointer-events-auto">
      {turns.map((turn, index) => {
        const isHovered = hoveredTurnIndex === index;
        const isActive = activeTurnId === turn.turn_id;
        const turnTitle = turn.user_prompt
          ? turn.user_prompt.trim().replace(/\n+/g, " ")
          : (turn.attachments && turn.attachments.length > 0 ? `[附件] ${turn.attachments[0].name}` : "会话轮次");
        const displayTitle = turnTitle.length > 36 ? turnTitle.slice(0, 36) + "..." : turnTitle;

        // 生成回答摘要
        let snippet = "";
        if (turn.assistant_response) {
          snippet = turn.assistant_response
            .replace(/[#*`_~>\-\n]/g, " ")
            .trim()
            .slice(0, 100);
        } else if (turn.thought) {
          snippet = turn.thought.replace(/\n+/g, " ").trim().slice(0, 100);
        } else if (turn.steps && turn.steps.length > 0) {
          snippet = `正在执行中 (${turn.steps.length} 项步骤)...`;
        } else {
          snippet = "等待模型答复中...";
        }

        return (
          <div
            key={turn.turn_id || index}
            className="relative flex items-center justify-center py-0.5 group cursor-pointer"
            onMouseEnter={() => setHoveredTurnIndex(index)}
            onMouseLeave={() => setHoveredTurnIndex(null)}
            onClick={() => onScrollToTurn(turn.turn_id ?? index)}
          >
            {/* 当前视口所在的激活轮次指示微光点 */}
            {isActive && !isHovered && (
              <span className="absolute -left-1.5 w-1 h-1 rounded-full bg-blue-500/80 dark:bg-blue-400/80 animate-pulse" />
            )}

            {/* 刻度短横线 (跟随视口滚动跟踪高亮，鼠标悬停伸长高亮，点击平滑滚动至该轮气泡) */}
            <div
              className={`h-0.5 rounded-full transition-all duration-200 ${
                isActive
                  ? "w-5.5 bg-blue-500 dark:bg-blue-400 shadow-[0_0_3px_rgba(59,130,246,0.25)]"
                  : isHovered
                  ? "w-5 bg-gray-900 dark:bg-white shadow-xs"
                  : "w-3 bg-gray-300 dark:bg-gray-600 group-hover:w-4.5 group-hover:bg-gray-700 dark:group-hover:bg-gray-300"
              }`}
            />

            {/* 悬停信息小卡片 (对标图二样式) */}
            {isHovered && (
              <div
                className="absolute left-6 top-1/2 -translate-y-1/2 w-72 p-3 bg-white dark:bg-[#1b1e2a] border border-gray-200 dark:border-[#2a2e40] rounded-xl shadow-xl z-50 text-xs text-gray-800 dark:text-gray-100 animate-in fade-in zoom-in-95 duration-100 pointer-events-none select-text"
              >
                <div className="font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 mb-1.5 flex items-start gap-1">
                  <span className="text-blue-600 dark:text-blue-400 font-mono font-bold shrink-0">
                    {index + 1}.
                  </span>
                  <span>{displayTitle}</span>
                </div>
                {snippet && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed">
                    {snippet}...
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
