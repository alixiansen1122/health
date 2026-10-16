"use client";

import { useOptimistic, type ReactNode } from "react";

type TrainingRecordProps = {
  id: string;
  completed: boolean;
  action: (formData: FormData) => Promise<void>;
  details: ReactNode;
  editForm: ReactNode;
  after: ReactNode;
};

export function TrainingRecord({ id, completed, action, details, editForm, after }: TrainingRecordProps) {
  const [showCheck, setShowCheck] = useOptimistic(completed, (_current, next: boolean) => next);

  return (
    <div className={`health-list-row training-record${showCheck ? " completed" : ""}`}>
      <form
        action={async (formData: FormData) => {
          setShowCheck(!showCheck);
          await action(formData);
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button type="submit" className={`check-button${showCheck ? " filled" : ""}`} aria-label={showCheck ? "标记为未完成并编辑" : "标记为已完成"}>{showCheck ? "✓" : ""}</button>
      </form>
      <div className="training-record-main">
        {details}
        {!showCheck && <details className="training-edit"><summary className="text-button">编辑训练内容</summary>{editForm}</details>}
      </div>
      {after}
    </div>
  );
}
