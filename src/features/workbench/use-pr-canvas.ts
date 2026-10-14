'use client';

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';

type Camera = { x: number; y: number; scale: number };
type Frame = { width: number; height: number };
type Point = { x: number; y: number };
type Gesture = { id: number; start: Point; camera: Camera };

export function usePrCanvas(world: Frame, signature: string) {
  const surface = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [frame, setFrame] = useState<Frame>({ width: 740, height: 440 });
  const [dragging, setDragging] = useState(false);
  const live = useRef({ camera, frame, world, fitted: true });
  const gesture = useRef<Gesture | null>(null);

  function publish(next: Camera, fitted = false) {
    live.current.camera = next;
    live.current.fitted = fitted;
    setCamera(next);
  }

  function fit() {
    const { frame: bounds, world: content } = live.current;
    const scale = Math.min(1, (bounds.width - 32) / content.width, (bounds.height - 32) / content.height);
    publish({ scale, x: (bounds.width - content.width * scale) / 2, y: (bounds.height - content.height * scale) / 2 }, true);
  }

  function zoom(factor: number, anchor?: Point) {
    const { camera: previous, frame: bounds, world: content } = live.current;
    const pivot = anchor ?? { x: bounds.width / 2, y: bounds.height / 2 };
    const minimum = Math.min(.15, Math.min((bounds.width - 32) / content.width, (bounds.height - 32) / content.height) / 2);
    const scale = Math.max(minimum, Math.min(3, previous.scale * factor));
    publish({ scale, x: pivot.x - (pivot.x - previous.x) / previous.scale * scale, y: pivot.y - (pivot.y - previous.y) / previous.scale * scale });
  }

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    live.current.world = world;
    live.current.fitted = true;
    function measure() {
      if (!element || !element.getClientRects().length) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1) return;
      const height = Math.max(240, Math.min(960, window.innerHeight - (rect.top + window.scrollY) - 76));
      const previous = live.current.frame;
      const next = { width: rect.width, height };
      live.current.frame = next;
      setFrame(current => current.width === next.width && current.height === next.height ? current : next);
      if (live.current.fitted) fit();
      else if (previous.width !== next.width || previous.height !== next.height) publish({ ...live.current.camera, x: live.current.camera.x + (next.width - previous.width) / 2, y: live.current.camera.y + (next.height - previous.height) / 2 });
    }
    function wheel(event: WheelEvent) {
      if (!event.deltaY) return;
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(Math.exp(-Math.max(-180, Math.min(180, pixels)) * .0025), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const page = element.closest('.review-page');
    if (page) observer.observe(page);
    window.addEventListener('resize', measure);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      element.removeEventListener('wheel', wheel);
    };
    // Refit only when graph geometry or membership changes; evidence refresh keeps the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.width, world.height, signature]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current || ![0, 1].includes(event.button)) return;
    if (event.button === 0 && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, camera: live.current.camera };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    publish({ ...current.camera, x: current.camera.x + event.clientX - current.start.x, y: current.camera.y + event.clientY - current.start.y });
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
    else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); fit(); }
    else if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      publish({ ...live.current.camera, x: live.current.camera.x + (event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0), y: live.current.camera.y + (event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0) });
    }
  }
  function reveal(point: Point) {
    const { camera: current, frame: bounds } = live.current;
    const x = point.x * current.scale + current.x;
    const y = point.y * current.scale + current.y;
    if (x < 40 || x > bounds.width - 40 || y < 40 || y > bounds.height - 90) publish({ ...current, x: bounds.width / 2 - point.x * current.scale, y: bounds.height / 2 - point.y * current.scale });
  }
  return { surface, camera, frame, dragging, fit, zoom, reveal, pointerDown, pointerMove, pointerEnd, keyDown };
}
