import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type Ctx = { open: boolean; contactId: string | null; openLead: (id: string) => void; closeLead: () => void };
const LeadDrawerCtx = createContext<Ctx | null>(null);

export function LeadDrawerProvider({ children }: { children: ReactNode }) {
  const [contactId, setContactId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const openLead = useCallback((id: string) => { setContactId(id); setOpen(true); }, []);
  const closeLead = useCallback(() => setOpen(false), []);
  return (
    <LeadDrawerCtx.Provider value={{ open, contactId, openLead, closeLead }}>
      {children}
    </LeadDrawerCtx.Provider>
  );
}

export function useLeadDrawer() {
  const ctx = useContext(LeadDrawerCtx);
  if (!ctx) throw new Error("useLeadDrawer must be used inside LeadDrawerProvider");
  return ctx;
}
