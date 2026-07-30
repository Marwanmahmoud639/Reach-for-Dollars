
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'follow_up',
  ADD COLUMN IF NOT EXISTS reminder_offset_minutes integer,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_notes text;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('call','email','meeting','follow_up','other'));

CREATE INDEX IF NOT EXISTS tasks_reminder_due_idx
  ON public.tasks (status, due_at)
  WHERE reminder_sent_at IS NULL AND reminder_offset_minutes IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_contact_idx
  ON public.tasks (contact_id, status, due_at);
