import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Check, CheckCircle2, Circle, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { listContactTasks, createTask, updateTask, deleteTask, listTeamMembers } from "@/lib/tasks.functions";
import { useAuth } from "@/lib/auth";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  task_type: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "complete" | "overdue";
  due_at: string | null;
  reminder_offset_minutes: number | null;
  user_id: string | null;
  created_by_user_id: string | null;
  completed_at: string | null;
};

type Member = { id: string; name: string | null; email: string };

const REMINDER_OPTIONS = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At due time" },
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const TYPES: { value: string; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "follow_up", label: "Follow-up" },
  { value: "other", label: "Other" },
];

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContactTasks({ contactId }: { contactId: string }) {
  const { user } = useAuth();
  const list = useServerFn(listContactTasks);
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const del = useServerFn(deleteTask);
  const listMembers = useServerFn(listTeamMembers);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "",
    notes: "",
    task_type: "follow_up",
    priority: "medium" as "high" | "medium" | "low",
    due_at: "",
    reminder: "60",
    assigned_to: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await list({ data: { contact_id: contactId } });
      setTasks(r.tasks as Task[]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    listMembers({ data: undefined as any })
      .then((r) => setMembers(r.members as Member[]))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const resetForm = () =>
    setForm({ title: "", notes: "", task_type: "follow_up", priority: "medium", due_at: "", reminder: "60", assigned_to: "" });

  const submit = async () => {
    if (!form.title.trim()) return toast.error("Title is required");
    setSaving(true);
    try {
      const dueIso = form.due_at ? new Date(form.due_at).toISOString() : null;
      await create({
        data: {
          contact_id: contactId,
          title: form.title.trim(),
          notes: form.notes.trim() || null,
          task_type: form.task_type as any,
          priority: form.priority,
          due_at: dueIso,
          reminder_offset_minutes: form.reminder === "" ? null : Number(form.reminder),
          assigned_to: form.assigned_to || null,
        },
      });
      toast.success("Task created");
      resetForm();
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (t: Task) => {
    try {
      await update({ data: { id: t.id, status: t.status === "complete" ? "pending" : "complete" } });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const remove = async (t: Task) => {
    if (!confirm("Delete this task?")) return;
    try {
      await del({ data: { id: t.id } });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const memberName = (id: string | null) => {
    if (!id) return "Unassigned";
    if (id === user?.id) return "You";
    const m = members.find((m) => m.id === id);
    return m?.name || m?.email || "Teammate";
  };

  const open = tasks.filter((t) => t.status !== "complete");
  const done = tasks.filter((t) => t.status === "complete");

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Tasks {open.length > 0 && <Badge variant="secondary" className="text-[10px]">{open.length} open</Badge>}</h3>
        {!showForm && (
          <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New task
          </Button>
        )}
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-3 space-y-2.5 bg-muted/30">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Follow up about quote"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional details"
              className="min-h-[60px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={form.task_type} onValueChange={(v) => setForm((f) => ({ ...f, task_type: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as any }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="datetime-local" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Reminder</Label>
              <Select value={form.reminder} onValueChange={(v) => setForm((f) => ({ ...f, reminder: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((r) => <SelectItem key={r.value || "none"} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Assign to</Label>
            <Select value={form.assigned_to || user?.id || ""} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Yourself" /></SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.id === user?.id ? "Me" : (m.name || m.email)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); resetForm(); }} disabled={saving}>
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              Create
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tasks yet. Click <span className="font-medium">New task</span> to add one.</p>
      ) : (
        <div className="space-y-1.5">
          {[...open, ...done].map((t) => (
            <TaskRow key={t.id} task={t} memberName={memberName} onToggle={toggleDone} onDelete={remove} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TaskRow({
  task,
  memberName,
  onToggle,
  onDelete,
}: {
  task: Task;
  memberName: (id: string | null) => string;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const isDone = task.status === "complete";
  const overdue = !isDone && task.due_at && new Date(task.due_at).getTime() < Date.now();
  const priorityClass =
    task.priority === "high" ? "text-red-500" : task.priority === "low" ? "text-muted-foreground" : "text-amber-500";
  return (
    <div className={`border border-border rounded-lg p-2.5 text-sm flex items-start gap-2 ${isDone ? "opacity-60" : ""}`}>
      <button onClick={() => onToggle(task)} className="mt-0.5 shrink-0" aria-label="Toggle done">
        {isDone ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-muted-foreground hover:text-foreground" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${isDone ? "line-through" : ""}`}>{task.title}</div>
        {task.notes && <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{task.notes}</div>}
        <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{task.task_type.replace("_", " ")}</Badge>
          <span className={priorityClass}>● {task.priority}</span>
          {task.due_at && (
            <span className={`inline-flex items-center gap-1 ${overdue ? "text-red-500" : ""}`}>
              <Clock className="w-3 h-3" /> {new Date(task.due_at).toLocaleString()}
              {overdue && " · overdue"}
            </span>
          )}
          <span>· {memberName(task.user_id)}</span>
        </div>
      </div>
      <button onClick={() => onDelete(task)} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
