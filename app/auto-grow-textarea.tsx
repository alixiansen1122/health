"use client";

import { useLayoutEffect, useRef, type FormEvent, type TextareaHTMLAttributes } from "react";

function fitContent(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function AutoGrowTextarea({ onInput, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => fitContent(ref.current), [props.defaultValue]);

  function handleInput(event: FormEvent<HTMLTextAreaElement>) {
    fitContent(event.currentTarget);
    onInput?.(event);
  }

  return <textarea {...props} ref={ref} onInput={handleInput} />;
}
