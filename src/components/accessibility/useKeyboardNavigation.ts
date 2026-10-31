/**
 * Accessibility — Keyboard navigation hook.
 *
 * Provides arrow-key navigation for menus, lists, tabs, and grids.
 * Pressing ArrowDown/ArrowRight moves to the next item,
 * ArrowUp/ArrowLeft moves to the previous item,
 * Home/End jump to first/last, and Enter/Space activates.
 *
 * Returns focus management props and a handler to attach to the container.
 */

import { useCallback, useState } from "react";

export interface UseKeyboardNavigationOptions {
  items: HTMLElement[];
  loop?: boolean;
  onActivate?: (index: number) => void;
}

export function useKeyboardNavigation({
  items,
  loop = true,
  onActivate,
}: UseKeyboardNavigationOptions) {
  const [activeIndex, setActiveIndex] = useState(0);

  const move = useCallback(
    (delta: number) => {
      const current = items;
      if (current.length === 0) return;
      let next = (activeIndex + delta) % current.length;
      if (next < 0) next = current.length - 1;
      if (!loop && (next < 0 || next >= current.length)) return;
      setActiveIndex(next);
      current[next]?.focus();
    },
    [activeIndex, items, loop],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          move(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          move(-1);
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(0);
          items[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(items.length - 1);
          items[items.length - 1]?.focus();
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onActivate?.(activeIndex);
          break;
      }
    },
    [activeIndex, items, onActivate, move],
  );

  const getItemProps = useCallback(
    (index: number) => ({
      ref: items[index],
      tabIndex: index === activeIndex ? 0 : -1,
      "aria-selected": index === activeIndex,
      onKeyDown: handleKeyDown,
      onFocus: () => setActiveIndex(index),
    }),
    [activeIndex, handleKeyDown, items],
  );

  return {
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    getItemProps,
  };
}
