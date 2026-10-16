"use client";

import { useEffect, useState, type ReactNode } from "react";

type TrainingRecordProps = {
  id: string;
  completed: boolean;
  action: (formData: FormData) => Promise<void>;
  details: ReactNode;
  editForm: ReactNode;
  after: ReactNode;
};

export function TrainingRecord({ id, completed, action, details, editForm, after }: TrainingRecordProps) {
  const [showCheck, setShowCheck] = useState(completed);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setShowCheck(completed);
  }, [completed]);

  return (
    <div className={`health-list-row training-record${showCheck ? " completed" : ""}`}>
      <form
        action={async (formData: FormData) => {
          const nextCompleted = !showCheck;
          setShowCheck(nextCompleted);
          setSaving(true);
          formData.set("completed", nextCompleted ? "1" : "0");
          try {
            await action(formData);
          } catch (error) {
            setShowCheck(completed);
            throw error;
          } finally {
            setSaving(false);
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={saving} className={`check-button${showCheck ? " filled" : ""}`} aria-label={showCheck ? "标记为未完成并编辑" : "标记为已完成"}>{showCheck ? "✓" : ""}</button>
      </form>
      <div className="training-record-main">
        {showCheck ? details : editForm}
      </div>
      {after}
    </div>
  );
}
