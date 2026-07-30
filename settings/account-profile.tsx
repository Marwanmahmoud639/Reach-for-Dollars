import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Loader2, Mail } from "lucide-react";
import { z } from "zod";

const TIMEZONES = (typeof Intl !== "undefined" && (Intl as any).supportedValuesOf)
  ? (Intl as any).supportedValuesOf("timeZone") as string[]
  : ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo"];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
];

const profileSchema = z.object({
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).regex(/^[+0-9 ()-]*$/, "Invalid phone").optional(),
  company: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(80).optional(),
  preferred_language: z.string().trim().max(8).optional(),
});

async function resizeToSquare(file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2;
    const sy = (img.height - min) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Failed to encode image"))), "image/jpeg", 0.9),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AccountProfile() {
  const { profile, user, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const [form, setForm] = useState({
    first_name: profile?.first_name ?? "",
    last_name: profile?.last_name ?? "",
    phone: profile?.phone ?? "",
    company: profile?.company ?? "",
    title: profile?.title ?? "",
    timezone: profile?.timezone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"),
    preferred_language: profile?.preferred_language ?? "en",
  });

  const initials = ((profile?.first_name?.[0] ?? "") + (profile?.last_name?.[0] ?? "")).toUpperCase()
    || (profile?.name || profile?.email || "?").slice(0, 2).toUpperCase();

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      toast.error("Please choose a JPG, PNG, or WebP image");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image must be under 8 MB");
      return;
    }
    setUploading(true);
    try {
      const blob = await resizeToSquare(file, 512);
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`;
      const { error: updErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      if (updErr) throw updErr;
      await refresh();
      toast.success("Profile picture updated");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (!user) return;
    setUploading(true);
    try {
      const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
      if (error) throw error;
      await refresh();
      toast.success("Removed");
    } catch (err: any) {
      toast.error(err.message ?? "Failed");
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSaving(true);
    try {
      const fullName = [form.first_name, form.last_name].filter(Boolean).join(" ").trim();
      const patch = { ...parsed.data, ...(fullName ? { name: fullName } : {}) };
      const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
      if (error) throw error;
      await refresh();
      toast.success("Profile saved");
    } catch (err: any) {
      toast.error(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const submitEmailChange = async () => {
    const email = newEmail.trim().toLowerCase();
    const valid = z.string().email().max(254).safeParse(email);
    if (!valid.success) {
      toast.error("Enter a valid email address");
      return;
    }
    if (email === profile?.email) {
      toast.error("That is already your current email");
      return;
    }
    setEmailSending(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email },
        { emailRedirectTo: `${window.location.origin}/settings` },
      );
      if (error) throw error;
      toast.success(`Verification link sent to ${email}`);
      setEmailOpen(false);
      setNewEmail("");
    } catch (err: any) {
      toast.error(err.message ?? "Could not send verification");
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <Card className="p-6 bg-card space-y-6">
      <div>
        <h3 className="font-semibold mb-3">Profile picture</h3>
        <div className="flex items-center gap-4">
          <Avatar className="w-20 h-20">
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="Avatar" />}
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFileChange} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onPickFile} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                {profile?.avatar_url ? "Replace" : "Upload"}
              </Button>
              {profile?.avatar_url && (
                <Button type="button" variant="ghost" onClick={removeAvatar} disabled={uploading}>Remove</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG, or WebP. Cropped to square, resized to 512×512.</p>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="font-semibold mb-3">Email</h3>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>Current email</Label>
            <Input value={profile?.email ?? ""} disabled readOnly />
          </div>
          <Button type="button" variant="outline" onClick={() => setEmailOpen(true)}>
            <Mail className="w-4 h-4 mr-2" /> Change email
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="font-semibold mb-3">Contact details</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>First name</Label>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div>
            <Label>Phone (E.164 preferred)</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 512 555 1234" />
          </div>
          <div>
            <Label>Company / organization</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div>
            <Label>Title / role</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label>Timezone</Label>
            <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
              <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Preferred language</Label>
            <Select value={form.preferred_language} onValueChange={(v) => setForm({ ...form, preferred_language: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={saveProfile} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change email address</DialogTitle>
            <DialogDescription>
              We'll send a verification link to the new address. Your email changes only after you confirm it there.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Current email</Label>
              <Input value={profile?.email ?? ""} disabled readOnly />
            </div>
            <div>
              <Label>New email</Label>
              <Input type="email" autoFocus value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmailOpen(false)} disabled={emailSending}>Cancel</Button>
            <Button onClick={submitEmailChange} disabled={emailSending}>
              {emailSending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send verification link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
