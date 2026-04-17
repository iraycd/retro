import { createContext, useContext, useRef, useState, useCallback } from "react";
import { Modal } from "./Modal";

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface Pending extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setPending({ ...opts, resolve });
    });
  }, []);

  function settle(value: boolean) {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal title={pending.title} onClose={() => settle(false)}>
          {pending.body && (
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
              {pending.body}
            </p>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => settle(false)}>Cancel</button>
            <button
              className={`btn ${pending.danger ? "danger" : "primary"}`}
              onClick={() => settle(true)}
              data-autofocus
            >
              {pending.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
