import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Phase = 'open' | 'opening' | 'closing' | 'closed';

/** One owned clock for width, the moving surface, and the replacement entry. */
export function useDockedLibraryMotion({ navigationRef, surfaceRef, open, width, enabled }: {
  navigationRef: RefObject<HTMLDivElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
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
  const paint = useCallback((value: number) => {
    const navigation = navigationRef.current, surface = surfaceRef.current;
    if (!navigation || !surface) return;
    visibleWidth.current = value;
    navigation.style.width = `${value}px`;
    surface.style.transform = `translateX(calc(${value}px - 100%))`;
    surface.style.visibility = value > 0 ? 'visible' : 'hidden';
  }, [navigationRef, surfaceRef]);

  // Pointer previews remain DOM-only: no React update on every drag frame.
  const previewWidth = useCallback((value: number) => {
    if (!openRef.current || !navigationRef.current) return;
    cancel();
    paint(value);
    publish('open');
  }, [cancel, navigationRef, paint, publish]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current, surface = surfaceRef.current;
    if (!navigation || !surface || !enabled) {
      cancel();
      mountedNode.current = null;
      return;
    }
    const target = open ? width : 0;
    const firstMount = mountedNode.current !== navigation;
    mountedNode.current = navigation;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    // A previous run's interpolated value was captured before its cancellation.
    const start = visibleWidth.current;
    cancel();
    const ticket = owner.current;
    let disposed = false;
    const finish = () => {
      if (disposed || ticket !== owner.current) return;
      // Commit the final geometry before releasing animation ownership.
      paint(target);
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
      // Explicitly share the timeline, including when reversing mid-transition.
      widthAnimation.startTime = surfaceAnimation.startTime = document.timeline.currentTime;
      animations.current = [widthAnimation, surfaceAnimation];
      void Promise.all(animations.current.map(animation => animation.finished)).then(finish, () => {});
    }
    return () => {
      disposed = true;
      media.removeEventListener('change', reduce);
      if (ticket === owner.current) {
        visibleWidth.current = navigation.getBoundingClientRect().width;
        cancel();
      }
    };
  }, [open, width, enabled, navigationRef, surfaceRef, cancel, paint, publish]);

  return { phase, previewWidth };
}
