import { useEffect, useRef } from 'react';

/**
 * Вызывает callback сразу и затем раз в intervalMs. Колбэк держится в ref:
 * новый объект опций на каждом рендере не перезапускает интервал (раньше
 * из-за этого опрос дёргал сервер на каждом рендере).
 */
export function usePolling(callback: (() => void) | undefined, intervalMs: number) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const tick = () => callbackRef.current?.();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
