/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageCircle,
  X,
  Plus,
  History,
  Search,
  Send,
  Sparkles,
  Loader2,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  sendMessage,
  confirmTool,
} from "@/lib/assistant.functions";

type Msg = {
  id?: string;
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_name?: string | null;
  tool_args?: any;
  tool_result?: any;
};

export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "lookup" | "history">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);

  const sendFn = useServerFn(sendMessage);
  const createFn = useServerFn(createConversation);
  const getFn = useServerFn(getConversation);
  const listFn = useServerFn(listConversations);
  const deleteFn = useServerFn(deleteConversation);
  const confirmFn = useServerFn(confirmTool);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const { conversation } = await createFn({ data: {} });
    setConversationId(conversation.id);
    setMessages([]);
    return conversation.id;
  };

  const refreshList = async () => {
    const { conversations } = await listFn({});
    setConversations(conversations);
  };

  useEffect(() => {
    if (open && tab === "history") refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  const openConversation = async (id: string) => {
    const { messages } = await getFn({ data: { id } });
    setConversationId(id);
    setMessages(messages as any);
    setTab("chat");
  };

  const newChat = () => {
    setConversationId(null);
    setMessages([]);
    setTab("chat");
  };

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    const cid = await ensureConversation();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    try {
      const res = await sendFn({ data: { conversationId: cid, content: text } });
      // Reload full thread to pick up tool results too.
      const { messages } = await getFn({ data: { id: cid } });
      setMessages(messages as any);
      void res;
    } catch (e: any) {
      toast.error(e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const confirmPendingTool = async (toolName: string, args: any) => {
    if (!conversationId) return;
    setSending(true);
    try {
      await confirmFn({ data: { conversationId, toolName, args } });
      const { messages } = await getFn({ data: { id: conversationId } });
      setMessages(messages as any);
      toast.success("Action completed");
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    } finally {
      setSending(false);
    }
  };

  const runLookup = async (q: {
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    country: "US" | "CA";
  }) => {
    const parts = [
      q.name && `name "${q.name}"`,
      q.phone && `phone ${q.phone}`,
      q.address && `address "${q.address}"`,
      q.city && `in ${q.city}`,
      q.state && q.state,
    ]
      .filter(Boolean)
      .join(", ");
    if (!parts) {
      toast.error("Enter at least one field");
      return;
    }
    setTab("chat");
    await send(`Reverse lookup (${q.country}): ${parts}. Check my DB first, then web.`);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-20 md:bottom-6 md:right-24 z-50 h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
          aria-label="Open AI assistant"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-36 right-4 md:bottom-24 md:right-6 z-50 w-[min(420px,calc(100vw-2rem))] h-[min(640px,calc(100vh-6rem))] bg-card border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">AI Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={newChat} title="New chat">
                <Plus className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} title="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as any)}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="grid grid-cols-3 mx-2 mt-2">
              <TabsTrigger value="chat">
                <MessageCircle className="h-3.5 w-3.5 mr-1" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="lookup">
                <Search className="h-3.5 w-3.5 mr-1" />
                Lookup
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="h-3.5 w-3.5 mr-1" />
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 m-0 p-0">
              <ScrollArea className="flex-1 px-3 py-2">
                <div ref={scrollRef} className="space-y-3">
                  {messages.length === 0 && (
                    <div className="text-xs text-muted-foreground p-4 space-y-2">
                      <p className="font-medium text-foreground">Hi! I can:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Reverse-lookup owners by name/phone/address (US + CA)</li>
                        <li>Search your contacts database</li>
                        <li>Run bulk prospect searches</li>
                        <li>Create tasks, save leads, answer questions</li>
                      </ul>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <MessageBubble key={m.id || i} m={m} onConfirm={confirmPendingTool} />
                  ))}
                  {sending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                    </div>
                  )}
                </div>
              </ScrollArea>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="border-t p-2 flex gap-2"
              >
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything, or paste a name/phone/address…"
                  className="min-h-[40px] max-h-[120px] text-sm resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                />
                <Button type="submit" size="sm" disabled={sending || !input.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="lookup" className="flex-1 m-0 p-3 overflow-auto">
              <LookupForm onSubmit={runLookup} />
            </TabsContent>

            <TabsContent value="history" className="flex-1 m-0 p-0">
              <ScrollArea className="h-full">
                <div className="p-2 space-y-1">
                  {conversations.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                      No conversations yet.
                    </p>
                  )}
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className="group flex items-center gap-2 rounded hover:bg-muted"
                    >
                      <button
                        onClick={() => openConversation(c.id)}
                        className="flex-1 text-left p-2 text-sm truncate"
                      >
                        <div className="truncate font-medium">{c.title || "Untitled"}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(c.last_message_at).toLocaleString()}
                        </div>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={async () => {
                          await deleteFn({ data: { id: c.id } });
                          if (c.id === conversationId) newChat();
                          refreshList();
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </>
  );
}

function MessageBubble({ m, onConfirm }: { m: Msg; onConfirm: (name: string, args: any) => void }) {
  if (m.role === "tool") {
    const res = m.tool_result || {};
    return (
      <div className="text-xs bg-muted/50 rounded p-2 border-l-2 border-primary/50">
        <div className="font-medium text-muted-foreground mb-1">🔧 {m.tool_name}</div>
        {res.error ? (
          <div className="text-destructive">{res.error}</div>
        ) : (
          <ToolResultView name={m.tool_name || ""} result={res} />
        )}
      </div>
    );
  }
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{m.content}</div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ""}</ReactMarkdown>
          </div>
        )}
        {m.tool_name && m.tool_args && (
          <div className="mt-2 pt-2 border-t border-border/40">
            <div className="text-xs text-muted-foreground mb-1">
              Pending action: <b>{m.tool_name}</b>
            </div>
            <pre className="text-[10px] bg-background/50 p-1 rounded overflow-auto max-h-32">
              {JSON.stringify(m.tool_args, null, 2)}
            </pre>
            <Button size="sm" className="mt-2" onClick={() => onConfirm(m.tool_name!, m.tool_args)}>
              <Check className="h-3 w-3 mr-1" />
              Confirm
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolResultView({ name, result }: { name: string; result: any }) {
  if (name === "search_contacts_db" && Array.isArray(result.contacts)) {
    return (
      <div>
        <div className="text-muted-foreground mb-1">
          {result.count} match{result.count === 1 ? "" : "es"} in your DB
        </div>
        {result.contacts.slice(0, 5).map((c: any) => (
          <div key={c.id} className="py-0.5">
            • {c.name}
            {c.phone && ` · ${c.phone}`}
            {c.city && ` · ${c.city}`}
          </div>
        ))}
      </div>
    );
  }
  if (name === "reverse_lookup_web" && Array.isArray(result.hits)) {
    return (
      <div>
        <div className="text-muted-foreground mb-1">
          {result.hits.length} web result{result.hits.length === 1 ? "" : "s"} ({result.source})
        </div>
        {result.hits.slice(0, 5).map((h: any, i: number) => (
          <div key={i} className="py-0.5">
            <a
              href={h.source_url}
              target="_blank"
              rel="noreferrer"
              className="underline text-primary"
            >
              {h.source_title || h.source_url}
            </a>
            {h.snippet && (
              <div className="text-muted-foreground text-[11px]">{h.snippet.slice(0, 140)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre className="text-[10px] overflow-auto max-h-32">{JSON.stringify(result, null, 2)}</pre>
  );
}

function LookupForm({ onSubmit }: { onSubmit: (q: any) => void }) {
  const [q, setQ] = useState({
    name: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    country: "US" as "US" | "CA",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(q);
      }}
      className="space-y-2"
    >
      <div className="text-xs text-muted-foreground">
        Reverse-lookup owner info. US + Canada only.
      </div>
      <Input
        placeholder="Full name"
        value={q.name}
        onChange={(e) => setQ({ ...q, name: e.target.value })}
      />
      <Input
        placeholder="Phone number"
        value={q.phone}
        onChange={(e) => setQ({ ...q, phone: e.target.value })}
      />
      <Input
        placeholder="Street address"
        value={q.address}
        onChange={(e) => setQ({ ...q, address: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="City"
          value={q.city}
          onChange={(e) => setQ({ ...q, city: e.target.value })}
        />
        <Input
          placeholder="State / Province"
          value={q.state}
          onChange={(e) => setQ({ ...q, state: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <select
          value={q.country}
          onChange={(e) => setQ({ ...q, country: e.target.value as "US" | "CA" })}
          className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="US">United States</option>
          <option value="CA">Canada</option>
        </select>
        <Button type="submit" className="flex-1">
          <Search className="h-4 w-4 mr-1" />
          Search
        </Button>
      </div>
    </form>
  );
}
