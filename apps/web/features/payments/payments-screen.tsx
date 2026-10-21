'use client';
import { useMemo, useState } from 'react';
import { DEMO_PAYMENTS, type DemoPayment } from './demo-payments';

export function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function PaymentsScreen() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const [selected, setSelected] = useState<DemoPayment | null>(null);

  const filtered = useMemo(() => {
    return DEMO_PAYMENTS.filter((p) => {
      if (q && !p.id.includes(q) && !p.orderRef.includes(q)) return false;
      if (status && p.status !== status) return false;
      if (method && p.method !== method) return false;
      return true;
    });
  }, [q, status, method]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // KPI formulas (demo data only):
  // Total Collected = sum(amount - refundAmount) for SUCCESS and PARTIALLY_REFUNDED records.
  // Total Refunded = sum(refundAmount) across all statuses.
  const kpis = {
    total: DEMO_PAYMENTS.length,
    success: DEMO_PAYMENTS.filter((p) => p.status === 'SUCCESS').length,
    pending: DEMO_PAYMENTS.filter((p) => p.status === 'PENDING').length,
    failed: DEMO_PAYMENTS.filter((p) => p.status === 'FAILED').length,
    collected: DEMO_PAYMENTS.filter(
      (p) => p.status === 'SUCCESS' || p.status === 'PARTIALLY_REFUNDED',
    ).reduce((s, p) => s + (p.amount - p.refundAmount), 0),
    refunded: DEMO_PAYMENTS.reduce((s, p) => s + p.refundAmount, 0),
  };
  function exportCsv() {
    const header = [
      'id',
      'orderRef',
      'customer',
      'method',
      'amount',
      'currency',
      'status',
      'createdAt',
    ];
    const rows = filtered.map((p) =>
      [p.id, p.orderRef, p.customer, p.method, p.amount, p.currency, p.status, p.createdAt]
        .map(csvEscape)
        .join(','),
    );
    const csv = [header.map(csvEscape).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'demo-payments.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Payments (DEMO)</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Total Transactions</div>
          <div className="text-2xl font-bold">{kpis.total}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Successful</div>
          <div className="text-2xl font-bold">{kpis.success}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Pending</div>
          <div className="text-2xl font-bold">{kpis.pending}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Failed</div>
          <div className="text-2xl font-bold">{kpis.failed}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Total Collected (paise)</div>
          <div className="text-2xl font-bold">{kpis.collected}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-sm text-muted">Total Refunded (paise)</div>
          <div className="text-2xl font-bold">{kpis.refunded}</div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input
          className="border rounded px-3 py-2"
          placeholder="Search payment/order"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="border rounded px-3 py-2"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="PENDING">Pending</option>
          <option value="FAILED">Failed</option>
          <option value="PARTIALLY_REFUNDED">Partial</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <select
          className="border rounded px-3 py-2"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All methods</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card</option>
          <option value="NET_BANKING">Net Banking</option>
          <option value="WALLET">Wallet</option>
        </select>
        <button className="border rounded px-3 py-2" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded border p-6 text-center text-muted">
          No matching demo payments.
          <button
            className="ml-2 text-orange-500"
            onClick={() => {
              setQ('');
              setStatus('');
              setMethod('');
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Payment ID</th>
              <th className="text-left p-2">Order Ref</th>
              <th className="text-left p-2">Customer</th>
              <th className="text-left p-2">Method</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="p-2">{p.id}</td>
                <td className="p-2">{p.orderRef}</td>
                <td className="p-2">{p.customer}</td>
                <td className="p-2">{p.method}</td>
                <td className="p-2">{p.amount}</td>
                <td className="p-2">{p.status}</td>
                <td className="p-2">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="p-2">
                  <button className="text-blue-600" onClick={() => setSelected(p)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-2 items-center">
        <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          Prev
        </button>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
          Next
        </button>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') setSelected(null);
          }}
        >
          <div className="bg-white rounded p-6 w-96">
            {' '}
            <h2 className="font-semibold mb-2">{selected.id}</h2>
            <div className="text-sm space-y-1">
              <div>Order: {selected.orderRef}</div>
              <div>Customer: {selected.customer}</div>
              <div>Method: {selected.method}</div>
              <div>
                Amount: {selected.amount} {selected.currency}
              </div>
              <div>Status: {selected.status}</div>
              <div>Refund: {selected.refundAmount}</div>
              <div>Date: {new Date(selected.createdAt).toLocaleString()}</div>
              <div className="text-muted">DEMO record</div>
            </div>
            <button className="mt-4 border rounded px-3 py-2" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
