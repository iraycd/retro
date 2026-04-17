import { useEffect, useRef, useId } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}

export function Modal({ title, onClose, children, maxWidth = 560 }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    return () => { previousFocus.current?.focus(); };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={{ maxWidth }}
      >
        <h3 id={headingId}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
