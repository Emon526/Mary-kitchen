"use client";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import { ShoppingCart, Star, Heart, Plus, Minus } from "lucide-react";
import { useCartStore } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency } from "@/lib/utils";
import api from "@/lib/api";
import { useState } from "react";

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    slug: string;
    base_price: string;
    compare_price?: string | null;
    /** From API; should match compare/original formula */
    discount_percentage?: number;
    /** List API: preferred sale price (product or best variant deal) */
    sale_price?: string | number | null;
    /** List API: strikethrough "was" price when on sale */
    compare_at_price?: string | number | null;
    average_rating: number;
    review_count: number;
    is_in_stock: boolean;
    primary_image: string | null;
    category_name: string;
    unit: string;
  };
}

export default function ProductCard({ product }: ProductCardProps) {
  const { cart, addItem, updateItem, removeItem } = useCartStore();
  const { isAuthenticated } = useAuthStore();
  const [busy, setBusy] = useState(false);

  const saleDisplay = product.sale_price ?? product.base_price;
  const compareDisplay =
    product.compare_at_price != null && product.compare_at_price !== ""
      ? product.compare_at_price
      : null;
  const discountPct =
    product.discount_percentage != null && Number(product.discount_percentage) > 0
      ? Math.round(Number(product.discount_percentage))
      : 0;

  const cartItem = cart?.items?.find((i) => i.product === product.id && !i.variant);
  const qty = cartItem?.quantity ?? 0;

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { toast.error("Please login to add items to cart"); return; }
    if (!product.is_in_stock) { toast.error("Out of stock"); return; }
    setBusy(true);
    try {
      await addItem(product.id);
      toast.success("Added to cart!");
    } catch {
      toast.error("Failed to add to cart");
    } finally {
      setBusy(false);
    }
  };

  const handleIncrease = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!cartItem || busy) return;
    setBusy(true);
    try {
      await updateItem(cartItem.id, qty + 1);
    } finally {
      setBusy(false);
    }
  };

  const handleDecrease = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!cartItem || busy) return;
    setBusy(true);
    try {
      if (qty <= 1) {
        await removeItem(cartItem.id);
      } else {
        await updateItem(cartItem.id, qty - 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleWishlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { toast.error("Please login"); return; }
    try {
      await api.post(`/users/wishlist/items/${product.id}/`);
      toast.success("Saved to wishlist");
    } catch {
      toast.error("Already in wishlist");
    }
  };

  return (
    <Link href={`/products/${product.slug}`} className="card group flex flex-col">
      {/* Image */}
      <div className="relative aspect-square overflow-hidden rounded-t-xl bg-gray-100">
        {product.primary_image ? (
          <Image
            src={product.primary_image}
            alt={product.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-gray-300">🛒</div>
        )}
        {discountPct > 0 && (
          <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            -{discountPct}%
          </span>
        )}
        {!product.is_in_stock && (
          <div className="absolute inset-0 bg-black/30 flex items-end">
            <span className="w-full bg-orange-500/90 text-white text-xs font-medium text-center py-1.5">Out of Stock</span>
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleWishlist} className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-md hover:bg-red-50">
            <Heart className="w-4 h-4 text-gray-500 hover:text-red-500" />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-xs text-gray-400 mb-1">{product.category_name}</p>
        <p className="text-sm font-semibold text-gray-800 line-clamp-2 flex-1 group-hover:text-primary-700 transition-colors">
          {product.name}
        </p>

        {/* Rating */}
        <div className="flex items-center gap-1 mt-1.5 mb-2">
          <div className="flex">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star key={s} className={`w-3 h-3 ${s <= Math.round(product.average_rating) ? "text-amber-400 fill-amber-400" : "text-gray-200"}`} />
            ))}
          </div>
          {product.review_count > 0 && <span className="text-xs text-gray-400">({product.review_count})</span>}
        </div>

        {/* Price + Cart controls */}
        <div className="flex items-center justify-between mt-auto gap-2">
          <div className="min-w-0">
            <span className="font-bold text-primary-700">{formatCurrency(saleDisplay)}</span>
            {discountPct > 0 && compareDisplay != null && compareDisplay !== "" && (
              <span className="text-xs text-gray-400 line-through ml-1">{formatCurrency(compareDisplay)}</span>
            )}
            <span className="text-xs text-gray-400 ml-1">/{product.unit}</span>
          </div>

          {qty > 0 ? (
            /* Quantity controls */
            <div className="flex items-center gap-1 bg-primary-50 rounded-full px-1 py-0.5 flex-shrink-0" onClick={(e) => e.preventDefault()}>
              <button
                onClick={handleDecrease}
                disabled={busy}
                className="w-6 h-6 bg-primary-700 hover:bg-primary-800 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-sm font-bold text-primary-700 w-5 text-center">{qty}</span>
              <button
                onClick={handleIncrease}
                disabled={busy}
                className="w-6 h-6 bg-primary-700 hover:bg-primary-800 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            /* Add to cart button */
            <button
              onClick={handleAdd}
              disabled={busy || !product.is_in_stock}
              className="w-8 h-8 bg-primary-700 hover:bg-primary-800 text-white rounded-full flex items-center justify-center transition-colors shadow-sm disabled:opacity-50 flex-shrink-0"
            >
              <ShoppingCart className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
