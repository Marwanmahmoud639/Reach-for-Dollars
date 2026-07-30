import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSocialAuthUrl, listSocialConnections, disconnectSocial } from "@/lib/social.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Link2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

export function SocialConnectionsPanel() {
  const qc = useQueryClient();
  const authUrl = useServerFn(getSocialAuthUrl);
  const list = useServerFn(listSocialConnections);
  const disconnect = useServerFn(disconnectSocial);

  const { data, isLoading } = useQuery({
    queryKey: ["social-connections"],
    queryFn: () => list({ data: {} as never }),
  });

  // The OAuth callback redirects back here with a result in the query string.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get("social_connected");
    const error = p.get("social_error");
    if (connected) {
      toast.success(`${connected} connected`);
      qc.invalidateQueries({ queryKey: ["social-connections"] });
    }
    if (error) toast.error(error);
    if (connected || error) {
      p.delete("social_connected");
      p.delete("social_error");
      const qs = p.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [qc]);

  const connectMut = useMutation({
    mutationFn: async (platform: string) =>
      authUrl({ data: { platform: platform as never, origin: window.location.origin } }),
    onSuccess: (res) => { window.location.href = res.url; },
    onError: (e: any) => toast.error(e?.message ?? "Could not start authorization"),
  });

  const disconnectMut = useMutation({
    mutationFn: async (platform: string) => disconnect({ data: { platform: platform as never } }),
    onSuccess: () => {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["social-connections"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to disconnect"),
  });

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2 font-semibold">
        <Link2 className="w-4 h-4" /> Social accounts
      </div>

      <div className="flex gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          These connections let you publish and message <strong>as yourself</strong>. They do not
          provide search across other people's profiles — no platform grants that through a login,
          so lead discovery continues to use the business-data sources instead.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      <div className="space-y-3">
        {(data?.providers ?? []).map((p: any) => (
          <div key={p.platform} className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.label}</span>
                {p.connection ? (
                  <Badge className="text-[10px] bg-[oklch(0.65_0.18_145)]/20 text-[oklch(0.65_0.18_145)]">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Not connected</Badge>
                )}
                {!p.configured && (
                  <Badge variant="outline" className="text-[10px] text-amber-500">Setup required</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{p.capabilities}</p>
              {p.connection?.display_name && (
                <p className="text-xs text-muted-foreground mt-0.5">Connected as {p.connection.display_name}</p>
              )}
              {p.needsAppReview && !p.connection && (
                <p className="text-xs text-amber-500/80 mt-0.5">
                  Requires an approved app in the provider's developer console.
                </p>
              )}
            </div>
            <div className="shrink-0">
              {p.connection ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => disconnectMut.mutate(p.platform)}
                  disabled={disconnectMut.isPending}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => connectMut.mutate(p.platform)}
                  disabled={connectMut.isPending}
                >
                  {connectMut.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Opening…</>
                    : "Connect"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
