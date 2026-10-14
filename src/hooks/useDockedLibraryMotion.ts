import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Phase = 'open' | 'opening' | 'closing' | 'closed';
type Point = { x: number; y: number };
const transform = ({ x, y }: Point) => `translate(${x}px, ${y}px)`;

/** One owned clock for width, surface and the same persistent toggle. */
export function useDockedLibraryMotion({ navigationRef, surfaceRef, toggleRef, toggleSlotRef, open, width, enabled }: {
  navigationRef: RefObject<HTMLDivElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  toggleRef: RefObject<HTMLButtonElement | null>;
  toggleSlotRef: RefObject<HTMLSpanElement | null>;
  open: boolean;
  width: number;
  enabled: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  const phaseRef = useRef(phase);
  const openRef = useRef(open);
  openRef.current = open;
  const owner = useRef(0);
  const animations = useRef<Animation[]>([]);
  const visibleWidth = useRef(open ? width : 0);
  const togglePosition = useRef<Point>({ x: 0, y: 0 });
  const mountedNode = useRef<HTMLElement | null>(null);

  const publish = useCallback((next: Phase) => {
    if (phaseRef.current === next) return;
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const cancel = useCallback(() => {
    owner.current++;
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);
  const expandedTogglePosition = useCallback((): Point => {
    const slot = toggleSlotRef.current, surface = surfaceRef.current;
    const toggle = toggleRef.current, navigation = navigationRef.current;
    if (!slot || !surface || !toggle || !navigation) return { x: 0, y: 0 };
    const anchor = slot.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
    // Subtract the surface's current translation: measure its stable header slot,
    // not the in-flight screen position. No hard-coded sidebar width or rem size.
    return {
      x: navigation.offsetLeft + surface.offsetLeft + anchor.left - bounds.left - toggle.offsetLeft,
      y: navigation.offsetTop + surface.offsetTop + anchor.top - bounds.top - toggle.offsetTop,
    };
  }, [navigationRef, surfaceRef, toggleRef, toggleSlotRef]);
  const paint = useCallback((value: number, position: Point = value > 0 ? expandedTogglePosition() : { x: 0, y: 0 }) => {
    const navigation = navigationRef.current, surface = surfaceRef.current;
    if (!navigation || !surface) return;
    visibleWidth.current = value;
    navigation.style.width = `${value}px`;
    surface.style.transform = `translateX(calc(${value}px - 100%))`;
    surface.style.visibility = value > 0 ? 'visible' : 'hidden';
    togglePosition.current = position;
    if (toggleRef.current) toggleRef.current.style.transform = transform(position);
  }, [navigationRef, surfaceRef, toggleRef, expandedTogglePosition]);

  // Pointer previews remain DOM-only: no React update on every drag frame.
  const previewWidth = useCallback((value: number) => {
    if (!openRef.current || phaseRef.current !== 'open' || !navigationRef.current) return;
    cancel();
    paint(value);
    publish('open');
  }, [cancel, navigationRef, paint, publish]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current, surface = surfaceRef.current, toggle = toggleRef.current;
    if (!navigation || !surface || !toggle || !enabled) {
      cancel();
      mountedNode.current = null;
      if (toggle) toggle.style.transform = '';
      togglePosition.current = { x: 0, y: 0 };
      return;
    }
    const target = open ? width : 0;
    const firstMount = mountedNode.current !== navigation;
    mountedNode.current = navigation;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    // A previous run's interpolated value was captured before its cancellation.
    const start = visibleWidth.current;
    const startPosition = togglePosition.current;
    const targetPosition = open ? expandedTogglePosition() : { x: 0, y: 0 };
    cancel();
    const ticket = owner.current;
    let disposed = false;
    const finish = () => {
      if (disposed || ticket !== owner.current) return;
      // Commit the final geometry before releasing animation ownership.
      paint(target, targetPosition);
      cancel();
      publish(open ? 'open' : 'closed');
    };
    const reduce = () => { if (media.matches) finish(); };
    media.addEventListener('change', reduce);
    if (firstMount || media.matches || Math.abs(target - start) < .5 || typeof navigation.animate !== 'function') {
      finish();
    } else {
      publish(open ? 'opening' : 'closing');
      navigation.style.width = `${target}px`;
      surface.style.transform = `translateX(calc(${target}px - 100%))`;
      surface.style.visibility = 'visible';
      const options: KeyframeAnimationOptions = {
        duration: Math.max(60, 240 * Math.min(1, Math.abs(target - start) / width)),
        easing: 'cubic-bezier(.22, .8, .25, 1)', fill: 'both',
      };
      const widthAnimation = navigation.animate([{ width: `${start}px` }, { width: `${target}px` }], options);
      const surfaceAnimation = surface.animate([
        { transform: `translateX(calc(${start}px - 100%))` },
        { transform: `translateX(calc(${target}px - 100%))` },
      ], options);
      toggle.style.transform = transform(targetPosition);
      const toggleAnimation = toggle.animate([
        { transform: transform(startPosition) }, { transform: transform(targetPosition) },
      ], options);
      // Explicitly share the timeline, including when reversing mid-transition.
      widthAnimation.startTime = surfaceAnimation.startTime = toggleAnimation.startTime = document.timeline.currentTime;
      animations.current = [widthAnimation, surfaceAnimation, toggleAnimation];
      void Promise.all(animations.current.map(animation => animation.finished)).then(finish, () => {});
    }
    return () => {
      disposed = true;
      media.removeEventListener('change', reduce);
      if (ticket === owner.current) {
        visibleWidth.current = navigation.getBoundingClientRect().width;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(toggle).transform);
        togglePosition.current = { x: matrix.m41, y: matrix.m42 };
        cancel();
      }
    };
  }, [open, width, enabled, navigationRef, surfaceRef, toggleRef, expandedTogglePosition, cancel, paint, publish]);

  return { phase, previewWidth };
}
