"use client";

// Строка со свайпом влево до кнопки «Удалить» (тикет 09), iOS-паттерн. Свайп
// раскрывает кнопку, тап по ней удаляет. Тап по содержимому (без заметного
// сдвига) отдаётся наверх как onTap (правка); если кнопка раскрыта — тап её
// прячет. Работает и на мыши, и на тач (pointer events).

import { useRef, useState, type ReactNode, type PointerEvent } from "react";

const REVEAL = 76; // ширина кнопки удаления, px
const THRESHOLD = 36; // сдвиг, после которого кнопка фиксируется раскрытой
const TAP_SLOP = 8; // сдвиг в пределах которого жест считается тапом

interface SwipeRowProps {
  children: ReactNode;
  onDelete: () => void;
  onTap?: () => void;
  deleteLabel?: string;
  /** Доступное имя действия удаления для скринридера. */
  deleteAriaLabel?: string;
}

export function SwipeRow({
  children,
  onDelete,
  onTap,
  deleteLabel = "Удалить",
  deleteAriaLabel,
}: SwipeRowProps) {
  const [dx, setDx] = useState(0); // текущий сдвиг контента (≤ 0)
  const [revealed, setRevealed] = useState(false);
  const startX = useRef(0);
  const startDx = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(0);

  function onPointerDown(e: PointerEvent) {
    dragging.current = true;
    moved.current = 0;
    startX.current = e.clientX;
    startDx.current = dx;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    moved.current = Math.max(moved.current, Math.abs(delta));
    // Только влево (delta<0) сверх текущего; не даём уйти правее 0 и левее REVEAL.
    const next = Math.min(0, Math.max(-REVEAL, startDx.current + delta));
    setDx(next);
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const open = dx <= -THRESHOLD;
    setRevealed(open);
    setDx(open ? -REVEAL : 0);
  }

  function handleClick() {
    // Тап после свайпа гасим (жест, не клик).
    if (moved.current > TAP_SLOP) return;
    if (revealed) {
      setRevealed(false);
      setDx(0);
      return;
    }
    onTap?.();
  }

  return (
    <div className="swipe-row">
      <button
        type="button"
        className="swipe-row-delete"
        style={{ width: REVEAL }}
        aria-label={deleteAriaLabel ?? deleteLabel}
        onClick={onDelete}
        tabIndex={revealed ? 0 : -1}
      >
        {deleteLabel}
      </button>
      <div
        className="swipe-row-content"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
}
