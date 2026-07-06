export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Hand-rolled pointer-event drag/resize for a freeform-positioned report element (no drag library needed). */
export function useDraggableElement(getRect: () => ElementRect, setRect: (r: ElementRect) => void) {
  let startX = 0;
  let startY = 0;
  let start: ElementRect = { x: 0, y: 0, width: 0, height: 0 };

  function onDragMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setRect({ ...start, x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) });
  }
  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  }
  function onDragStart(e: PointerEvent) {
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    start = { ...getRect() };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  }

  function onResizeMove(e: PointerEvent) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setRect({ ...start, width: Math.max(10, Math.round(start.width + dx)), height: Math.max(8, Math.round(start.height + dy)) });
  }
  function onResizeEnd() {
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeEnd);
  }
  function onResizeStart(e: PointerEvent) {
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    start = { ...getRect() };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeEnd);
  }

  return { onDragStart, onResizeStart };
}
