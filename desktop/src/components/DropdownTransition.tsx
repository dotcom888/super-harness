import React, { useEffect } from "react";
import { useModalTransition } from "../utils/useModalTransition";

export interface DropdownTransitionProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  duration?: number;
  zIndex?: number;
  origin?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "top" | "bottom";
  closeOnEsc?: boolean;
}

/**
 * 通用小弹窗 / 下拉菜单过渡组件
 * 支持 300ms 完整淡入淡出 (fade-in / fade-out) 与缩放 (scale 95% -> 100% -> 95%) 动效
 */
export const DropdownTransition: React.FC<DropdownTransitionProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  style,
  duration = 300,
  zIndex = 40,
  origin = "bottom-left",
  closeOnEsc = true,
}) => {
  const { mounted, visible } = useModalTransition(isOpen, duration);

  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  if (!mounted) return null;

  const originClass = {
    "top-left": "origin-top-left",
    "top-right": "origin-top-right",
    "bottom-left": "origin-bottom-left",
    "bottom-right": "origin-bottom-right",
    "center": "origin-center",
    "top": "origin-top",
    "bottom": "origin-bottom",
  }[origin] || "origin-bottom-left";

  const translateYClass = origin.startsWith("bottom")
    ? (visible ? "translate-y-0" : "translate-y-1.5")
    : (visible ? "translate-y-0" : "-translate-y-1.5");

  return (
    <>
      {/* 遮罩背景，用于捕获点击外部并平滑关闭 */}
      <div
        className={`fixed inset-0 cursor-default transition-opacity duration-300 ${
          visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        style={{ zIndex: zIndex - 1 }}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      />
      {/* 浮层菜单主体，严格执行 300ms 淡入淡出与缩放过渡 */}
      <div
        style={{ ...style, zIndex }}
        className={`transition-all duration-300 ease-out transform ${originClass} ${
          visible
            ? `opacity-100 scale-100 ${translateYClass}`
            : `opacity-0 scale-95 ${translateYClass} pointer-events-none`
        } ${className}`}
      >
        {children}
      </div>
    </>
  );
};
