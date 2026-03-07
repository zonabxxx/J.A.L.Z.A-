"use client";
import { useEffect, useState, useCallback } from "react";

interface OrderRow {
  id: string;
  orderNumber: string;
  name: string;
  status: string;
  priority?: string;
  customerName?: string;
  totalValue?: number;
  deadline?: string;
  createdAt?: string;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientName?: string;
  supplierName?: string;
  status: string;
  type?: string;
  totalAmount: number;
  issueDate?: string;
  dueDate?: string;
  paidAt?: string;
}

interface CustomerRow {
  id: string;
  name: string;
  businessName?: string;
  ico?: string;
  email?: string;
  phone?: string;
  city?: string;
  type?: string;
}

interface FinanceStats {
  period: string;
  orders: { activeCount: number; totalCount: number; totalValue: number; periodCount: number; periodValue: number };
  invoicesIssued: { totalUnpaid: number; countUnpaid: number; countOverdue: number; totalOverdue: number; periodRevenue: number; periodCount: number };
  invoicesIncoming: { totalUnpaid: number; countUnpaid: number };
  bank: { unmatchedCount: number; totalCredit: number; totalDebit: number };
  margin: { avgMargin: number; lossCount: number };
}

interface SummaryData {
  orders: { active: number; draft: number; completed: number; totalValue: number; newThisMonth: number };
  invoicesIssued: { unpaid: number; overdue: number; monthRevenue: number };
  invoicesIncoming: { unpaid: number };
  activeOrders: OrderRow[];
}

type Section = "summary" | "orders" | "invoices" | "incoming" | "customers" | "finance" | "calculations";

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Návrh",
  CONFIRMED: "Potvrdená",
  IN_PROGRESS: "V realizácii",
  COMPLETED: "Dokončená",
  CANCELLED: "Zrušená",
  sent: "Odoslaná",
  paid: "Zaplatená",
  overdue: "Po splatnosti",
  draft: "Návrh",
  received: "Prijatá",
  approved: "Schválená",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-600",
  CONFIRMED: "bg-blue-600",
  IN_PROGRESS: "bg-yellow-600",
  COMPLETED: "bg-green-600",
  CANCELLED: "bg-red-600",
  sent: "bg-blue-600",
  paid: "bg-green-600",
  overdue: "bg-red-600",
  draft: "bg-zinc-600",
  received: "bg-yellow-600",
  approved: "bg-green-600",
};

function fmt(n?: number) {
  if (n == null) return "—";
  return new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";
}

export default function BusinessPanel({ onMenuToggle, onBack }: Props) {
  const [section, setSection] = useState<Section>("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [invoicesList, setInvoicesList] = useState<InvoiceRow[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [incomingList, setIncomingList] = useState<InvoiceRow[]>([]);
  const [incomingTotal, setIncomingTotal] = useState(0);
  const [customersList, setCustomersList] = useState<CustomerRow[]>([]);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [finance, setFinance] = useState<FinanceStats | null>(null);
  const [financePeriod, setFinancePeriod] = useState("this_month");
  const [orderStatusFilter, setOrderStatusFilter] = useState("");

  const fetchData = useCallback(async (sec: Section, extra: Record<string, string> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: sec, ...extra });
      const res = await fetch(`/api/business?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      switch (sec) {
        case "summary": setSummary(data); break;
        case "orders": setOrders(data.orders || []); setOrdersTotal(data.total || 0); break;
        case "invoices": setInvoicesList(data.invoices || []); setInvoicesTotal(data.total || 0); break;
        case "incoming-invoices" as any: setIncomingList(data.invoices || []); setIncomingTotal(data.total || 0); break;
        case "customers": setCustomersList(data.customers || []); setCustomersTotal(data.total || 0); break;
        case "finance": setFinance(data); break;
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "summary") fetchData("summary");
    else if (section === "orders") fetchData("orders", { limit: "20", ...(orderStatusFilter ? { status: orderStatusFilter } : {}) });
    else if (section === "invoices") fetchData("invoices", { limit: "20" });
    else if (section === "incoming") fetchData("incoming-invoices" as any, { limit: "20" });
    else if (section === "customers") fetchData("customers", { limit: "30" });
    else if (section === "finance") fetchData("finance", { period: financePeriod });
  }, [section, fetchData, financePeriod, orderStatusFilter]);

  const handleSearch = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "search",
          query: search,
          type: section === "customers" ? "customers" : section === "invoices" ? "invoices" : "orders",
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (section === "customers") { setCustomersList(data.customers || []); setCustomersTotal(data.total || 0); }
      else if (section === "invoices") { setInvoicesList(data.invoices || []); setInvoicesTotal(data.total || 0); }
      else { setOrders(data.orders || []); setOrdersTotal(data.total || 0); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, section]);

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: "summary", label: "Prehľad", icon: "📊" },
    { id: "orders", label: "Zákazky", icon: "📦" },
    { id: "invoices", label: "Faktúry", icon: "📄" },
    { id: "incoming", label: "Prijaté", icon: "📥" },
    { id: "customers", label: "Zákazníci", icon: "👥" },
    { id: "finance", label: "Financie", icon: "💰" },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        <button onClick={onMenuToggle} className="md:hidden text-zinc-400 hover:text-white text-xl">☰</button>
        <div className="flex-1">
          <h2 className="text-lg font-bold">Business</h2>
          <p className="text-xs text-zinc-500">Zákazky, faktúry, financie</p>
        </div>
        {onBack && (
          <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800">
            ← Späť
          </button>
        )}
      </header>

      <div className="flex gap-1 px-4 py-2 border-b border-zinc-800 overflow-x-auto">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSection(s.id); setSearch(""); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              section === s.id
                ? "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {["orders", "invoices", "customers"].includes(section) && (
        <div className="flex gap-2 px-4 py-2 border-b border-zinc-800">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={`Hľadať ${section === "customers" ? "zákazníkov" : section === "invoices" ? "faktúry" : "zákazky"}...`}
            className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-medium transition-colors"
          >
            Hľadať
          </button>
          {section === "orders" && (
            <select
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value)}
              className="bg-zinc-800 rounded-lg px-2 py-1.5 text-xs outline-none"
            >
              <option value="">Všetky stavy</option>
              <option value="DRAFT">Návrh</option>
              <option value="CONFIRMED">Potvrdená</option>
              <option value="IN_PROGRESS">V realizácii</option>
              <option value="COMPLETED">Dokončená</option>
            </select>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-zinc-500">Načítavam...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && section === "summary" && summary && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Aktívne zákazky" value={summary.orders.active} onClick={() => { setSection("orders"); setOrderStatusFilter("IN_PROGRESS"); }} />
              <StatCard label="Nové tento mesiac" value={summary.orders.newThisMonth} />
              <StatCard label="Obrat (mesiac)" value={fmt(summary.invoicesIssued.monthRevenue)} />
              <StatCard label="Nezaplatené FA" value={fmt(summary.invoicesIssued.unpaid)} alert={summary.invoicesIssued.overdue > 0} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Návrhy" value={summary.orders.draft} onClick={() => { setSection("orders"); setOrderStatusFilter("DRAFT"); }} />
              <StatCard label="Dokončené" value={summary.orders.completed} />
              <StatCard label="Prijaté FA (nezapl.)" value={fmt(summary.invoicesIncoming.unpaid)} />
            </div>

            {summary.activeOrders.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-400 mb-2">Aktívne zákazky</h3>
                <div className="space-y-1">
                  {summary.activeOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
                      <div>
                        <span className="text-xs text-zinc-500 mr-2">{o.orderNumber}</span>
                        <span className="text-sm">{o.name}</span>
                        {o.customerName && <span className="text-xs text-zinc-500 ml-2">— {o.customerName}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{fmt(o.totalValue)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] text-white ${STATUS_COLORS[o.status] || "bg-zinc-600"}`}>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && section === "orders" && (
          <div>
            <div className="text-xs text-zinc-500 mb-3">{ordersTotal} zákaziek</div>
            <div className="space-y-1">
              {orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 font-mono">{o.orderNumber}</span>
                      <span className="text-sm font-medium truncate">{o.name}</span>
                    </div>
                    {o.customerName && <div className="text-xs text-zinc-500 mt-0.5">{o.customerName}</div>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-medium">{fmt(o.totalValue)}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] text-white ${STATUS_COLORS[o.status] || "bg-zinc-600"}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </div>
                </div>
              ))}
              {orders.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">Žiadne zákazky</div>}
            </div>
          </div>
        )}

        {!loading && !error && section === "invoices" && (
          <div>
            <div className="text-xs text-zinc-500 mb-3">{invoicesTotal} faktúr</div>
            <div className="space-y-1">
              {invoicesList.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 font-mono">{inv.invoiceNumber}</span>
                      <span className="text-sm truncate">{inv.clientName}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString("sk-SK") : ""}
                      {inv.dueDate && <span className="ml-2">splatnosť: {new Date(inv.dueDate).toLocaleDateString("sk-SK")}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-medium">{fmt(inv.totalAmount)}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] text-white ${STATUS_COLORS[inv.status] || "bg-zinc-600"}`}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </div>
                </div>
              ))}
              {invoicesList.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">Žiadne faktúry</div>}
            </div>
          </div>
        )}

        {!loading && !error && section === "incoming" && (
          <div>
            <div className="text-xs text-zinc-500 mb-3">{incomingTotal} prijatých faktúr</div>
            <div className="space-y-1">
              {incomingList.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 font-mono">{inv.invoiceNumber}</span>
                      <span className="text-sm truncate">{inv.supplierName}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString("sk-SK") : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-medium">{fmt(inv.totalAmount)}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] text-white ${STATUS_COLORS[inv.status] || "bg-zinc-600"}`}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </div>
                </div>
              ))}
              {incomingList.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">Žiadne prijaté faktúry</div>}
            </div>
          </div>
        )}

        {!loading && !error && section === "customers" && (
          <div>
            <div className="text-xs text-zinc-500 mb-3">{customersTotal} zákazníkov</div>
            <div className="space-y-1">
              {customersList.map((c) => (
                <div key={c.id} className="px-3 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{c.name}</span>
                      {c.businessName && c.businessName !== c.name && (
                        <span className="text-xs text-zinc-500 ml-2">{c.businessName}</span>
                      )}
                    </div>
                    {c.type && <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">{c.type}</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-zinc-500">
                    {c.ico && <span>IČO: {c.ico}</span>}
                    {c.email && <span>{c.email}</span>}
                    {c.phone && <span>{c.phone}</span>}
                    {c.city && <span>{c.city}</span>}
                  </div>
                </div>
              ))}
              {customersList.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">Žiadni zákazníci</div>}
            </div>
          </div>
        )}

        {!loading && !error && section === "finance" && finance && (
          <div className="space-y-6">
            <div className="flex gap-2">
              {[
                { value: "this_month", label: "Mesiac" },
                { value: "this_quarter", label: "Kvartál" },
                { value: "this_year", label: "Rok" },
              ].map((p) => (
                <button
                  key={p.value}
                  onClick={() => setFinancePeriod(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    financePeriod === p.value
                      ? "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30"
                      : "text-zinc-500 hover:text-zinc-300 bg-zinc-800"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Aktívne zákazky" value={finance.orders.activeCount} sub={`celkom: ${finance.orders.totalCount}`} />
              <StatCard label="Hodnota aktívnych" value={fmt(finance.orders.totalValue)} />
              <StatCard label="Nové (obdobie)" value={finance.orders.periodCount} sub={fmt(finance.orders.periodValue)} />
              <StatCard label="Obrat (zaplatené)" value={fmt(finance.invoicesIssued.periodRevenue)} />
              <StatCard label="Nezaplatené FA" value={fmt(finance.invoicesIssued.totalUnpaid)} sub={`${finance.invoicesIssued.countUnpaid} faktúr`} alert={finance.invoicesIssued.countOverdue > 0} />
              <StatCard label="Po splatnosti" value={fmt(finance.invoicesIssued.totalOverdue)} sub={`${finance.invoicesIssued.countOverdue} faktúr`} alert />
              <StatCard label="Prijaté (nezapl.)" value={fmt(finance.invoicesIncoming.totalUnpaid)} sub={`${finance.invoicesIncoming.countUnpaid} faktúr`} />
              <StatCard label="Priem. marža" value={`${finance.margin.avgMargin.toFixed(1)}%`} sub={finance.margin.lossCount > 0 ? `${finance.margin.lossCount} stratových` : undefined} alert={finance.margin.lossCount > 0} />
              <StatCard label="Bank (nepárované)" value={finance.bank.unmatchedCount} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, alert, onClick }: {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-3 border transition-colors ${
        alert ? "bg-red-500/5 border-red-500/20" : "bg-zinc-900 border-zinc-800"
      } ${onClick ? "cursor-pointer hover:border-blue-500/30" : ""}`}
    >
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold ${alert ? "text-red-400" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}
