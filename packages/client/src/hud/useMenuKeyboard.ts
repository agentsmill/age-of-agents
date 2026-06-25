import { useEffect, type RefObject } from 'react';

/**
 * ARIA "menu" keyboard pattern for a simple dropdown with role="menuitem*" buttons.
 *
 *  - On open, moves focus to the active (aria-checked="true") or first option.
 *  - ArrowDown/ArrowUp move focus cyclically, Home/End jump to edges.
 *
 * Works on live DOM (querySelectorAll in the container), so it does not require
 * per-option refs or roving tabindex. Components handle Esc and click-outside separately.
 */
export function useMenuKeyboard(open: boolean, menuRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const items = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

    // Focus na aktywnej (checked) lub pierwszej opcji zaraz po otwarciu.
    const initial = items();
    (initial.find((el) => el.getAttribute('aria-checked') === 'true') ?? initial[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      let next: number;
      switch (e.key) {
        case 'ArrowDown':
          next = (idx + 1) % list.length;
          break;
        case 'ArrowUp':
          next = (idx <= 0 ? list.length : idx) - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = list.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      list[next]?.focus();
    };

    menu.addEventListener('keydown', onKey);
    return () => menu.removeEventListener('keydown', onKey);
  }, [open, menuRef]);
}
