"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";
import { useCartStore } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency, getStatusColor } from "@/lib/utils";
import { ShoppingCart, Heart, Star, ChevronRight, Minus, Plus } from "lucide-react";
import ReviewSection from "@/components/product/ReviewSection";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ProductDetailPage() {
  const { slug } = useParams();
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const { addItem } = useCartStore();
  const { isAuthenticated } = useAuthStore();

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.get(`/products/${slug}/`).then((r) => r.data),
  });

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      toast.error("Please login to add items to cart");
      return;
    }
    try {
      await addItem(product.id, selectedVariant || undefined, quantity);
      toast.success("Added to cart!");
    } catch {
      toast.error("Failed to add to cart");
    }
  };

  const handleWishlist = async () => {
    if (!isAuthenticated) {
      toast.error("Please login to save to wishlist");
      return;
    }
    try {
      await api.post(`/users/wishlist/items/${product.id}/`);
      toast.success("Added to wishlist!");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Already in wishlist");
    }
  };

  if (isLoading) {
    return (
      <div className="container-xl py-8">
        <div className="grid md:grid-cols-2 gap-8">
          <Skeleton className="h-96 rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) return <div className="container-xl py-20 text-center text-gray-400">Product not found</div>;

  const images = product.images || [];
  const variants = product.variants?.filter((v: any) => v.is_active) || [];
  const currentVariant = variants.find((v: any) => v.id === selectedVariant);

  const variantOnSale =
    currentVariant &&
    currentVariant.compare_price != null &&
    Number(currentVariant.compare_price) > Number(currentVariant.price);
  const displaySale = currentVariant
    ? currentVariant.price
    : product.sale_price ?? product.base_price;
  const displayCompare = currentVariant
    ? variantOnSale
      ? currentVariant.compare_price
      : null
    : product.compare_at_price != null && String(product.compare_at_price).length > 0
      ? product.compare_at_price
      : null;
  const displayDiscountPct = currentVariant
    ? Number(currentVariant.discount_percentage) > 0
      ? Math.round(Number(currentVariant.discount_percentage))
      : 0
    : Number(product.discount_percentage) > 0
      ? Math.round(Number(product.discount_percentage))
      : 0;

  const primaryImageSrc = (idx: number) => {
    const raw = images[idx]?.image;
    if (!raw) return null;
    return absoluteMediaUrl(raw) ?? raw;
  };

  return (
    <div className="container-xl py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/" className="hover:text-primary-700">Home</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href="/products" className="hover:text-primary-700">Products</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href={`/products?category=${product.category?.slug}`} className="hover:text-primary-700">
          {product.category?.name}
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 font-medium truncate max-w-xs">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-6 lg:gap-12">
        {/* Images */}
        <div>
          <div className="relative h-64 sm:h-80 md:h-auto md:aspect-square rounded-2xl overflow-hidden bg-gray-100 mb-3">
            {images[activeImage] && primaryImageSrc(activeImage) ? (
              <Image
                src={primaryImageSrc(activeImage)!}
                alt={images[activeImage].alt_text || product.name}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 text-6xl">🛒</div>
            )}
            {!product.is_in_stock && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-full">Out of Stock</span>
              </div>
            )}
            {displayDiscountPct > 0 && (
              <div className="absolute top-3 left-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                -{displayDiscountPct}%
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((img: any, i: number) => (
                <button
                  key={img.id}
                  onClick={() => setActiveImage(i)}
                  className={`relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                    activeImage === i ? "border-primary-600" : "border-gray-200"
                  }`}
                >
                  <Image src={absoluteMediaUrl(img.image) || img.image} alt="" fill className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          <p className="text-sm text-primary-700 font-medium mb-1">{product.category?.name}</p>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">{product.name}</h1>

          {/* Rating */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= Math.round(product.average_rating) ? "text-amber-400 fill-amber-400" : "text-gray-300"}`}
                />
              ))}
            </div>
            <span className="text-sm text-gray-600">({product.review_count} reviews)</span>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-3 mb-4 flex-wrap">
            <span className="text-3xl font-bold text-primary-700">{formatCurrency(displaySale)}</span>
            {displayCompare != null &&
              displayCompare !== "" &&
              Number(displayCompare) > Number(displaySale) && (
                <span className="text-lg text-gray-400 line-through">{formatCurrency(displayCompare)}</span>
              )}
            <span className="text-sm text-gray-500">/ {product.unit}</span>
          </div>

          {/* Stock */}
          <div className="mb-4">
            {product.is_in_stock ? (
              <span className="text-sm text-green-600 font-medium">✓ In Stock ({product.stock_quantity} available)</span>
            ) : (
              <span className="text-sm text-orange-500 font-medium">
                ⚠ Out of Stock – {product.allow_out_of_stock_orders ? "You can still order" : "Ordering unavailable"}
              </span>
            )}
          </div>

          {/* Variants */}
          {variants.length > 0 && (
            <div className="mb-5">
              <p className="text-sm font-semibold text-gray-700 mb-2">Select Option:</p>
              <div className="flex flex-wrap gap-2">
                {variants.map((v: any) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v.id === selectedVariant ? null : v.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      selectedVariant === v.id
                        ? "bg-primary-700 text-white border-primary-700"
                        : "bg-white text-gray-700 border-gray-300 hover:border-primary-500"
                    } ${!v.is_in_stock ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {v.name} – {formatCurrency(v.price)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Qty + Add to Cart */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 py-2 hover:bg-gray-100 text-gray-600"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="px-4 py-2 font-semibold text-gray-900 min-w-[2.5rem] text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 py-2 hover:bg-gray-100 text-gray-600"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={handleAddToCart}
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              Add to Cart
            </button>
            <button
              onClick={handleWishlist}
              className="p-2.5 border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
            >
              <Heart className="w-5 h-5 text-gray-500 hover:text-red-500" />
            </button>
          </div>

          {/* Description */}
          {product.description && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-2">Description</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{product.description}</p>
            </div>
          )}

          {/* Dynamic Attributes */}
          {Object.keys(product.attributes || {}).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-3">Product Details</h3>
              <dl className="grid grid-cols-2 gap-2">
                {product.attribute_definitions?.map((def: any) => (
                  product.attributes[def.key] && (
                    <div key={def.key} className="text-sm">
                      <dt className="text-gray-500">{def.name}</dt>
                      <dd className="font-medium text-gray-900">{product.attributes[def.key]}</dd>
                    </div>
                  )
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Reviews */}
      <ReviewSection productId={product.id} />
    </div>
  );
}
