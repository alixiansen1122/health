"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "./actions";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({ action, className, children }: { action: FormAction; className?: string; children: ReactNode }) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const details = formRef.current?.closest("details");
    if (!details) return;
    const focusFirst = () => {
      if (details.open) requestAnimationFrame(() => details.querySelector<HTMLElement>("input,select,textarea")?.focus());
    };
    details.addEventListener("toggle", focusFirst);
    if (details.open) focusFirst();
    return () => details.removeEventListener("toggle", focusFirst);
  }, []);

  useEffect(() => {
    if (state?.ok) {
      const details = formRef.current?.closest("details");
      if (details) details.open = false;
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {state?.error && <p className="form-error" role="alert">{state.error}</p>}
      {children}
    </form>
  );
}
