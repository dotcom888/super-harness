import { useEffect, useState } from "react";

/**
 * 为弹窗提供「挂载 -> 入场动画 -> 停留 -> 退场动画 -> 卸载」的完整过渡状态。
 * - mounted: 是否仍需要渲染 DOM
 * - visible: 当前是否处于完全可见状态（用于切换 opacity / scale 过渡类）
 */
export function useModalTransition(isOpen: boolean, duration = 300) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    setVisible(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [isOpen, duration]);

  return { mounted, visible };
}
