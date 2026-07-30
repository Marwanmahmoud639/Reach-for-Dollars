import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, Save, Pencil, X } from "lucide-react";

type Note = { id: string; content: string; user_id: string; created_at: string; updated_at: string; author_name?: string };

export function ContactNotes({ contactId }: { contactId: string }) {
  const { user, team, role } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = async () => {
    if (!team?.id) return;
    const { data } = await supabase
      .from("contact_notes")
      .select("*, profiles:user_id(name,email)")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    setNotes((data ?? []).map((n: any) => ({ ...n, author_name: n.profiles?.name || n.profiles?.email || "User" })));
  };
  useEffect(() => { load(); }, [contactId, team?.id]);

  const add = async () => {
    if (!draft.trim() || !team?.id || !user?.id) return;
    const { error } = await supabase.from("contact_notes").insert({
      team_id: team.id, contact_id: contactId, user_id: user.id, content: draft.trim(),
    });
    if (error) return toast.error(error.message);
    setDraft(""); load();
  };
  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    const { error } = await supabase.from("contact_notes").update({ content: editText.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingId(null); setEditText(""); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this note?")) return;
    const { error } = await supabase.from("contact_notes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const canEdit = (n: Note) => n.user_id === user?.id || role === "admin" || role === "manager";

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">Notes</h3>
      <div className="flex gap-2">
        <Textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note…" className="min-h-[60px]" />
        <Button onClick={add} disabled={!draft.trim()} className="self-end">Add</Button>
      </div>
      <div className="space-y-2">
        {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
        {notes.map(n => (
          <div key={n.id} className="border rounded-md p-3 text-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span><strong className="text-foreground">{n.author_name}</strong> · {new Date(n.created_at).toLocaleString()}</span>
              {canEdit(n) && (
                <div className="flex gap-1">
                  {editingId === n.id ? (
                    <>
                      <button onClick={() => saveEdit(n.id)} className="text-success hover:text-success/80"><Save className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { setEditingId(null); setEditText(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(n.id); setEditText(n.content); }} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(n.id)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </div>
              )}
            </div>
            {editingId === n.id ? (
              <Textarea value={editText} onChange={e => setEditText(e.target.value)} className="min-h-[60px]" />
            ) : (
              <p className="whitespace-pre-wrap">{n.content}</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
