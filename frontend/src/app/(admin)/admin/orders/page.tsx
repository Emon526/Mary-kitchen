"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { formatCurrency, formatDate, getStatusColor, orderStatusLabel } from "@/lib/utils";
import {
  Search, RefreshCw, RotateCcw, X, ArrowRight,
  Truck, ShoppingBag, AlertTriangle, ChevronDown,
} from "lucide-react";

const ALL_STATUSES = ["pending", "confirmed", "processing", "ready_for_pickup", "out_for_delivery", "delivered", "cancelled", "refunded"];
const ALL_DELIVERY_STATUSES = ["pending", "confirmed", "processing", "out_for_delivery", "delivered", "cancelled"];
const ALL_PICKUP_STATUSES   = ["pending", "confirmed", "processing", "ready_for_pickup", "delivered", "cancelled"];

const NEXT_STATUSES: Record<string, Record<string, string[]>> = {
  delivery: {
    pending:          ["confirmed", "cancelled"],
    confirmed:        ["processing", "cancelled"],
    processing:       ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "cancelled"],
    delivered:        [],
  },
  pickup: {
    pending:          ["confirmed", "cancelled"],
    confirmed:        ["processing", "cancelled"],
    processing:       ["ready_for_pickup", "cancelled"],
    ready_for_pickup: ["delivered", "cancelled"],
    delivered:        [],
  },
};

function getAllowedNextStatuses(orderType: string, currentStatus: string): string[] {
  return NEXT_STATUSES[orderType]?.[currentStatus] ?? [];
}

function Initials({ name }: { name: string }) {
  const parts = (name || "?").trim().split(" ");
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold uppercase shrink-0">
      {letters}
    </div>
  );
}

function AdminOrdersPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [forceUpdate, setForceUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [refundOrder, setRefundOrder] = useState<any>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundMode, setRefundMode] = useState<"items" | "amount" | "full">("items");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [refundAmountAud, setRefundAmountAud] = useState("");
  const [refunding, setRefunding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", search, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      return api.get(`/orders/admin/orders/?${params}`).then((r) => r.data);
    },
    refetchInterval: selectedOrder ? false : 5000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const orderNumber = searchParams.get("order");
    if (!orderNumber) return;
    let cancelled = false;
    api
      .get(`/orders/admin/orders/${encodeURIComponent(orderNumber)}/`)
      .then((res) => {
        if (cancelled) return;
        setSelectedOrder(res.data);
        const next = getAllowedNextStatuses(res.data.order_type, res.data.status);
        setNewStatus(next[0] ?? "");
      })
      .catch(() => { if (!cancelled) toast.error("Order not found"); })
      .finally(() => { if (!cancelled) router.replace("/admin/orders", { scroll: false }); });
    return () => { cancelled = true; };
  }, [searchParams, router]);

  const closeStatusModal = () => {
    setSelectedOrder(null);
    setNewStatus("");
    setNote("");
    setForceUpdate(false);
  };

  const handleStatusUpdate = async () => {
    if (!selectedOrder || !newStatus) return;
    setUpdating(true);
    try {
      await api.post(`/orders/admin/orders/${selectedOrder.order_number}/status/`, {
        status: newStatus, note, force: forceUpdate,
      });
      toast.success("Order status updated!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-order-notifications-unread"] });
      qc.invalidateQueries({ queryKey: ["admin-order-notifications"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue"] });
      closeStatusModal();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const openRefundModal = (order: any) => {
    setRefundOrder(order);
    setRefundReason("");
    setRefundMode("items");
    setSelectedItemIds(new Set());
    setRefundAmountAud("");
  };

  const closeRefundModal = () => {
    setRefundOrder(null);
    setRefundReason("");
    setRefundMode("items");
    setSelectedItemIds(new Set());
    setRefundAmountAud("");
  };

  const toggleItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedRefundTotal = (): number => {
    if (!refundOrder) return 0;
    return refundOrder.items
      .filter((it: any) => selectedItemIds.has(String(it.id)))
      .reduce((sum: number, it: any) => {
        const q = Math.max(0, it.quantity - (it.refunded_quantity ?? 0));
        return sum + q * parseFloat(it.unit_price);
      }, 0);
  };

  const handleRefund = async () => {
    if (!refundOrder) return;

    const body: Record<string, unknown> = { order_number: refundOrder.order_number, reason: refundReason };
    if (refundMode === "items") {
      if (selectedItemIds.size === 0) { toast.error("Select at least one item to refund"); return; }
      body.item_ids = Array.from(selectedItemIds);
    } else if (refundMode === "amount") {
      const aud = parseFloat(refundAmountAud);
      if (!refundAmountAud || isNaN(aud) || aud <= 0) { toast.error("Enter a valid refund amount in AUD"); return; }
      body.amount_cents = Math.round(aud * 100);
    }

    setRefunding(true);
    try {
      await api.post("/payments/refund/", body);
      toast.success("Refund processed successfully!");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue"] });
      qc.invalidateQueries({ queryKey: ["admin-refund-stats"] });
      closeRefundModal();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Refund failed. Check Stripe or order status.");
    } finally {
      setRefunding(false);
    }
  };

  const canRefund = (order: any) =>
    (order.payment_status === "paid" || order.payment_status === "partially_refunded") &&
    order.status !== "pending" && order.status !== "refunded";

  const orders = data?.results ?? [];
  const total = data?.count ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Order Management</h2>
          {!isLoading && <p className="text-sm text-gray-400 mt-0.5">{total} order{total !== 1 ? "s" : ""}</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4">
        <div className="p-4 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order # or customer email…"
              className="input-field pl-9 text-sm"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field text-sm w-auto pr-9 appearance-none"
            >
              <option value="">All Statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{orderStatusLabel(s)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["Order", "Customer", "Type", "Total", "Payment", "Status", "Date", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + (j * 13) % 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-gray-400">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No orders found</p>
                  </td>
                </tr>
              ) : (
                orders.map((order: any) => (
                  <tr
                    key={order.id}
                    className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${
                      order.has_out_of_stock_items ? "bg-orange-50/40" : ""
                    }`}
                  >
                    {/* Order # */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-primary-700 text-xs">#{order.order_number}</span>
                        {order.has_out_of_stock_items && (
                          <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        )}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Initials name={order.user_name} />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate max-w-[140px]">{order.user_name}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[140px]">{order.user_email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                        order.order_type === "pickup"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-blue-50 text-blue-700"
                      }`}>
                        {order.order_type === "pickup"
                          ? <ShoppingBag className="w-3 h-3" />
                          : <Truck className="w-3 h-3" />}
                        {order.order_type === "pickup" ? "Pickup" : "Delivery"}
                      </span>
                    </td>

                    {/* Total */}
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900">{formatCurrency(order.total_amount)}</span>
                      {order.items?.length > 0 && (
                        <p className="text-xs text-gray-400">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</p>
                      )}
                    </td>

                    {/* Payment */}
                    <td className="px-4 py-3.5">
                      <span className={`badge ${getStatusColor(order.payment_status)}`}>
                        {orderStatusLabel(order.payment_status)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className={`badge ${getStatusColor(order.status)}`}>
                        {orderStatusLabel(order.status, order.order_type)}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap text-xs">
                      {formatDate(order.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {!["refunded", "cancelled"].includes(order.status) && (
                          <button
                            onClick={() => {
                              setForceUpdate(false);
                              setSelectedOrder(order);
                              const next = getAllowedNextStatuses(order.order_type, order.status);
                              setNewStatus(next[0] ?? "");
                            }}
                            className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
                          >
                            Update
                          </button>
                        )}
                        {canRefund(order) && (
                          <button
                            onClick={() => openRefundModal(order)}
                            className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
                          >
                            <RotateCcw className="w-3 h-3" /> Refund
                          </button>
                        )}
                        {["refunded", "cancelled"].includes(order.status) && !canRefund(order) && (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Status Update Modal ─────────────────────────────────────────── */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Modal header */}
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">Update Order Status</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="font-mono text-xs text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md">
                    #{selectedOrder.order_number}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                    selectedOrder.order_type === "pickup"
                      ? "bg-purple-50 text-purple-700"
                      : "bg-blue-50 text-blue-700"
                  }`}>
                    {selectedOrder.order_type === "pickup" ? <ShoppingBag className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                    {selectedOrder.order_type}
                  </span>
                  <span className={`badge ${getStatusColor(selectedOrder.status)}`}>
                    {orderStatusLabel(selectedOrder.status, selectedOrder.order_type)}
                  </span>
                </div>
              </div>
              <button onClick={closeStatusModal} className="text-gray-400 hover:text-gray-600 transition-colors p-1 -mr-1 mt-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {getAllowedNextStatuses(selectedOrder.order_type, selectedOrder.status).length === 0 && !forceUpdate ? (
                /* Terminal state — prompt for force jump */
                <div className="rounded-xl border-2 border-dashed border-orange-200 bg-orange-50 p-5 text-center">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                  </div>
                  <p className="text-sm font-semibold text-orange-900 mb-1">Order reached final status</p>
                  <p className="text-xs text-orange-600 mb-4 leading-relaxed">
                    No further transitions are allowed. Enable force jump to manually override.
                  </p>
                  <button
                    onClick={() => {
                      setForceUpdate(true);
                      const list = selectedOrder.order_type === "pickup" ? ALL_PICKUP_STATUSES : ALL_DELIVERY_STATUSES;
                      setNewStatus(list[0] ?? "");
                    }}
                    className="inline-flex items-center gap-2 text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2 rounded-xl transition-colors"
                  >
                    Enable Force Jump
                  </button>
                </div>
              ) : (
                <>
                  {/* Force toggle */}
                  <label className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                    forceUpdate ? "border-orange-300 bg-orange-50" : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                  }`}>
                    <input
                      type="checkbox"
                      checked={forceUpdate}
                      onChange={(e) => {
                        setForceUpdate(e.target.checked);
                        const list = e.target.checked
                          ? (selectedOrder.order_type === "pickup" ? ALL_PICKUP_STATUSES : ALL_DELIVERY_STATUSES)
                          : getAllowedNextStatuses(selectedOrder.order_type, selectedOrder.status);
                        setNewStatus(list[0] ?? "");
                      }}
                      className="accent-orange-500 w-4 h-4 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-orange-700">Force status jump</p>
                      <p className="text-xs text-orange-500">Bypass normal transition rules</p>
                    </div>
                  </label>

                  {/* Status selector with transition preview */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">New Status</label>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`badge ${getStatusColor(selectedOrder.status)}`}>
                        {orderStatusLabel(selectedOrder.status, selectedOrder.order_type)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      {newStatus && (
                        <span className={`badge ${getStatusColor(newStatus)}`}>
                          {orderStatusLabel(newStatus, selectedOrder.order_type)}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value)}
                        className="input-field pr-9 appearance-none"
                      >
                        {(forceUpdate
                          ? (selectedOrder.order_type === "pickup" ? ALL_PICKUP_STATUSES : ALL_DELIVERY_STATUSES)
                          : getAllowedNextStatuses(selectedOrder.order_type, selectedOrder.status)
                        ).map((s: string) => (
                          <option key={s} value={s}>{orderStatusLabel(s, selectedOrder.order_type)}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </>
              )}

              {/* Note */}
              {newStatus && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Note <span className="text-gray-400 font-normal">(optional)</span></label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="input-field resize-none"
                    placeholder="Internal note visible in order history…"
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                {newStatus && (
                  <button
                    onClick={handleStatusUpdate}
                    disabled={updating}
                    className={`flex-1 flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-xl transition-colors disabled:opacity-60 ${
                      forceUpdate
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "btn-primary"
                    }`}
                  >
                    {updating ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                    {forceUpdate ? "Force Update" : "Confirm Update"}
                  </button>
                )}
                <button onClick={closeStatusModal} className="flex-1 btn-secondary py-2.5 rounded-xl">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Refund Modal ────────────────────────────────────────────────── */}
      {refundOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center">
                    <RotateCcw className="w-3.5 h-3.5 text-red-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">Issue Refund</h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-primary-700 bg-primary-50 px-2 py-0.5 rounded-md">
                    #{refundOrder.order_number}
                  </span>
                  <span className="text-xs text-gray-500">
                    Total <span className="font-semibold text-gray-900">{formatCurrency(refundOrder.total_amount)}</span>
                  </span>
                  {refundOrder.refunded_amount > 0 && (
                    <span className="text-xs bg-orange-50 text-orange-600 font-medium px-2 py-0.5 rounded-full">
                      {formatCurrency(refundOrder.refunded_amount)} already refunded
                    </span>
                  )}
                </div>
              </div>
              <button onClick={closeRefundModal} className="text-gray-400 hover:text-gray-600 transition-colors p-1 -mr-1 mt-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Refund mode pills */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Refund Method</label>
                <div className="flex gap-2">
                  {(["items", "amount", "full"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setRefundMode(mode); setSelectedItemIds(new Set()); setRefundAmountAud(""); }}
                      className={`flex-1 text-sm font-medium py-2 px-3 rounded-xl border transition-all ${
                        refundMode === mode
                          ? "bg-primary-600 text-white border-primary-600 shadow-sm"
                          : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {mode === "items" ? "By Items" : mode === "amount" ? "By Amount" : "Full"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Item checkboxes */}
              {refundMode === "items" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Select items to refund</label>
                  <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                    {refundOrder.items.map((item: any) => {
                      const refundableQty = Math.max(0, item.quantity - (item.refunded_quantity ?? 0));
                      const fullyRefunded = refundableQty === 0;
                      const checked = selectedItemIds.has(String(item.id));
                      return (
                        <label
                          key={item.id}
                          className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                            fullyRefunded
                              ? "opacity-50 cursor-not-allowed bg-gray-50"
                              : checked
                              ? "bg-primary-50 cursor-pointer"
                              : "cursor-pointer hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={fullyRefunded}
                            onChange={() => toggleItem(String(item.id))}
                            className="accent-primary-600 w-4 h-4 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {item.product_name}
                              {item.variant_name && <span className="text-gray-400 font-normal"> · {item.variant_name}</span>}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatCurrency(item.unit_price)} × {item.quantity}
                              {(item.refunded_quantity ?? 0) > 0 && (
                                <span className="ml-1.5 text-orange-500">({item.refunded_quantity} refunded)</span>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {fullyRefunded ? (
                              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Refunded</span>
                            ) : (
                              <span className="text-sm font-semibold text-gray-900">
                                {formatCurrency(refundableQty * parseFloat(item.unit_price))}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {selectedItemIds.size > 0 && (
                    <div className="mt-2 flex justify-end">
                      <span className="text-sm font-semibold text-primary-700 bg-primary-50 px-3 py-1 rounded-lg">
                        Refund total: {formatCurrency(selectedRefundTotal())}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Custom amount */}
              {refundMode === "amount" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Refund Amount (AUD)</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <input
                      type="number" min="0.01" step="0.01"
                      max={(refundOrder.total_amount - (refundOrder.refunded_amount ?? 0)).toFixed(2)}
                      value={refundAmountAud}
                      onChange={(e) => setRefundAmountAud(e.target.value)}
                      className="input-field pl-8"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Maximum: {formatCurrency(refundOrder.total_amount - (refundOrder.refunded_amount ?? 0))}
                  </p>
                </div>
              )}

              {/* Full refund summary */}
              {refundMode === "full" && (
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-sm text-gray-600">Full refund of</p>
                  <p className="text-2xl font-bold text-gray-900 mt-0.5">{formatCurrency(refundOrder.total_amount)}</p>
                  <p className="text-xs text-gray-400 mt-1">will be returned to the customer</p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Reason <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={2}
                  className="input-field resize-none"
                  placeholder="e.g. Customer request, item unavailable…"
                />
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  This triggers a real Stripe refund and <strong>cannot be undone</strong>.
                </p>
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-6 pb-6 pt-3 border-t border-gray-100 shrink-0 flex gap-3">
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {refunding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {refunding ? "Processing…" : "Confirm Refund"}
              </button>
              <button onClick={closeRefundModal} disabled={refunding} className="flex-1 btn-secondary py-2.5 rounded-xl">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-6">Order Management</h2>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    }>
      <AdminOrdersPageInner />
    </Suspense>
  );
}
