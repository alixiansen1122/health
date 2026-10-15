"use client";

import { useOptimistic } from "react";

export function TrainingToggle({ id, completed, action }: { id: string; completed: boolean; action: (formData: FormData) => Promise<void> }) {
  const [showCheck, toggleCheck] = useOptimistic(completed);
  return (
    <form
      action={async (formData: FormData) => {
        toggleCheck(!showCheck);
        await action(formData);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={`check-button${showCheck ? " filled" : ""}`} aria-label="切换训练完成状态">{showCheck ? "✓" : ""}</button>
    </form>
  );
}
