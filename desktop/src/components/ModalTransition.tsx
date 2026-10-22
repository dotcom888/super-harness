import React, { useEffect } from "react";
import { useModalTransition } from "../utils/useModalTransition";

export interface ModalTransitionProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  duration?: number;
  zIndex?: number;
  closeOnEsc?: boolean;
  closeOnClickOutside?: boolean;
}

/**
 * 通用大弹窗过渡组件（居中模态框）
 * 支持 300ms 完整淡入淡出 (fade-in / fade-out) 与缩放位移 (zoom-in / zoom-out) 动效
 */
export const ModalTransition: React.FC<ModalTransitionProps> = ({
  isOpen,
  onClose,
  children,
  className = "",
  backdropClassName = "",
  duration = 300,
  zIndex = 60,
  closeOnEsc = true,
  closeOnClickOutside = true,
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

  return (
    <div
      style={{ WebkitAppRegion: "no-drag", zIndex } as React.CSSProperties}
      className={`fixed inset-0 flex items-center justify-center p-4 select-none bg-black/45 backdrop-blur-xs transition-opacity duration-300 ease-out ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      } ${backdropClassName}`}
      onClick={() => {
        if (closeOnClickOutside) onClose?.();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`transition-all duration-300 ease-out transform ${
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2 pointer-events-none"
        } ${className}`}
      >
        {children}
      </div>
    </div>
  );
};
