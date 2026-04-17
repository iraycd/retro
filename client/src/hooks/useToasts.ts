import { useState, useCallback } from "react";

interface Toast {
  id: number;
  msg: string;
  fading: boolean;
}

export function useToasts(): [Toast[], (msg: string) => void] {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, fading: false }]);
    setTimeout(() => setToasts(t => t.map(x => x.id === id ? { ...x, fading: true } : x)), 2800);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  return [toasts, add];
}
