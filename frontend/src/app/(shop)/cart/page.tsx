"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import toast from "react-hot-toast";
import { useCartStore } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency } from "@/lib/utils";
import api from "@/lib/api";
import { Minus, Plus, Trash2, ShoppingCart, ArrowRight, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

interface InvalidItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  reason: string;
}

export default function CartPage() {
  const { cart, fetchCart, updateItem, removeItem, isLoading } = useCartStore();
  const { isAuthenticated } = useAuthStore();
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  const [invalidItems, setInvalidItems] = useState<InvalidItem[]>([]);
  const [validating, setValidating] = useState(false);

  const runValidation = useCallback(async () => {
    setValidating(true);
    try {
      const { data } = await api.get("/cart/validate/");
      const ids = new Set<string>((data.invalid_items ?? []).map((i: InvalidItem) => i.id));
      setInvalidIds(ids);
      setInvalidItems(data.invalid_items ?? []);
    } catch {
      // validation failure is non-fatal — cart still renders
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCart();
      runValidation();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="container-xl py-20 text-center">
        <ShoppingCart className="w-16 h-16 mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Please login to view your cart</h2>
        <Link href="/login" className="btn-primary inline-flex mt-4">Login</Link>
      </div>
    );
  }

  const items = cart?.items || [];

  if (!isLoading && items.length === 0) {
    return (
      <div className="container-xl py-20 text-center">
        <ShoppingCart className="w-16 h-16 mx-auto text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Your cart is empty</h2>
        <Link href="/products" className="btn-primary inline-flex mt-4">Start Shopping</Link>
      </div>
    );
  }

  const handleRemove = async (itemId: string) => {
    try {
      await removeItem(itemId);
      setInvalidIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
      setInvalidItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success("Item removed");
    } catch {
      toast.error("Failed to remove item");
    }
  };

  const handleRemoveAllInvalid = async () => {
    const ids = Array.from(invalidIds);
    await Promise.all(ids.map((id) => removeItem(id)));
    setInvalidIds(new Set());
    setInvalidItems([]);
    toast.success(`${ids.length} unavailable item${ids.length > 1 ? "s" : ""} removed`);
  };

  const validItems = items.filter((item) => !invalidIds.has(item.id));
  const hasInvalid = invalidIds.size > 0;
  const allInvalid = hasInvalid && validItems.length === 0;

  return (
    <div className="container-xl py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="section-title">Shopping Cart</h1>
        <button
          onClick={runValidation}
          disabled={validating}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          title="Re-check availability"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${validating ? "animate-spin" : ""}`} />
          Check availability
        </button>
      </div>

      {/* Warning banner — shown when some items are unavailable */}
      {hasInvalid && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {allInvalid
                ? "All items in your cart are currently unavailable."
                : `${invalidIds.size} item${invalidIds.size > 1 ? "s" : ""} in your cart ${invalidIds.size > 1 ? "are" : "is"} no longer available and will be excluded from your order.`}
            </p>
            {!allInvalid && (
              <p className="text-xs text-amber-700 mt-0.5">You can still checkout with the remaining available items.</p>
            )}
          </div>
          <button
            onClick={handleRemoveAllInvalid}
            className="flex-shrink-0 text-xs text-amber-700 font-semibold underline underline-offset-2 hover:text-amber-900 whitespace-nowrap"
          >
            Remove unavailable
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Items */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => {
            const unavailable = invalidIds.has(item.id);
            const reason = invalidItems.find((i) => i.id === item.id)?.reason;
            return (
              <div
                key={item.id}
                className={`card p-4 flex gap-4 transition-all duration-300 ${
                  unavailable ? "opacity-60 bg-gray-50" : ""
                }`}
              >
                {/* Image */}
                <div className={`relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 ${unavailable ? "grayscale" : ""}`}>
                  {item.product_detail?.primary_image ? (
                    <Image src={item.product_detail.primary_image} alt={item.product_detail.name} fill className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">🛒</div>
                  )}
                  {unavailable && (
                    <div className="absolute inset-0 bg-gray-900/30 flex items-center justify-center">
                      <XCircle className="w-6 h-6 text-white" />
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/products/${item.product_detail?.slug}`}
                    className={`font-semibold line-clamp-2 text-sm ${unavailable ? "text-gray-400 pointer-events-none" : "text-gray-900 hover:text-primary-700"}`}
                  >
                    {item.product_detail?.name}
                  </Link>
                  {item.variant_detail && (
                    <p className="text-xs text-gray-500 mt-0.5">{item.variant_detail.name}</p>
                  )}
                  {unavailable ? (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                      <XCircle className="w-3 h-3" />
                      {reason ?? "Currently unavailable"}
                    </span>
                  ) : (
                    <p className="text-sm text-primary-700 font-bold mt-1">{formatCurrency(item.unit_price)}</p>
                  )}
                </div>

                {/* Controls */}
                <div className="flex flex-col items-end gap-2">
                  {!unavailable && (
                    <p className="font-bold text-gray-900">{formatCurrency(item.line_total)}</p>
                  )}
                  <div className={`flex items-center gap-1 border border-gray-200 rounded-lg ${unavailable ? "opacity-40 pointer-events-none" : ""}`}>
                    <button
                      onClick={() => item.quantity > 1 && updateItem(item.id, item.quantity - 1)}
                      disabled={unavailable}
                      className="p-1.5 hover:bg-gray-100 text-gray-600 rounded-l-lg disabled:cursor-not-allowed"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="px-2 text-sm font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateItem(item.id, item.quantity + 1)}
                      disabled={unavailable}
                      className="p-1.5 hover:bg-gray-100 text-gray-600 rounded-r-lg disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <button onClick={() => handleRemove(item.id)} className="text-red-400 hover:text-red-600 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div>
          <div className="card p-6 sticky top-4">
            <h2 className="font-bold text-lg text-gray-900 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between text-gray-600">
                <span>
                  {hasInvalid
                    ? `Available items (${validItems.length})`
                    : `Subtotal (${cart?.total_items} items)`}
                </span>
                <span>{formatCurrency(validItems.reduce((sum: number, i) => sum + (Number(i.line_total) || 0), 0))}</span>
              </div>
              {hasInvalid && (
                <div className="flex justify-between text-xs text-red-500">
                  <span>Unavailable ({invalidIds.size} item{invalidIds.size > 1 ? "s" : ""} excluded)</span>
                  <span>—</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Delivery</span>
                <span className="text-primary-600">Calculated at checkout</span>
              </div>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-3 mb-5">
              <span>Subtotal</span>
              <span className="text-primary-700">
                {formatCurrency(validItems.reduce((sum: number, i) => sum + (Number(i.line_total) || 0), 0))}
              </span>
            </div>

            {allInvalid ? (
              <div className="text-center py-2">
                <p className="text-sm text-red-600 font-medium mb-3">All items are unavailable.</p>
                <button onClick={handleRemoveAllInvalid} className="btn-secondary w-full text-sm">
                  Clear Cart
                </button>
              </div>
            ) : (
              <Link href="/checkout" className="btn-primary w-full flex items-center justify-center gap-2">
                {hasInvalid ? "Checkout available items" : "Checkout"} <ArrowRight className="w-4 h-4" />
              </Link>
            )}
            <Link href="/products" className="btn-secondary w-full flex items-center justify-center mt-3 text-sm">
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
