"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingButtonProps = ComponentProps<"button"> & {
  pendingText?: ReactNode;
};

export function PendingButton({ children, pendingText = "处理中…", disabled, ...props }: PendingButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button {...props} disabled={disabled || pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
