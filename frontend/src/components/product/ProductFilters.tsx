"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

type ProductFiltersProps = {
  /** Base path for filter navigation (e.g. `/products` or `/products/deals`). */
  basePath?: string;
};

export default function ProductFilters({ basePath = "/products" }: ProductFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/products/categories/").then((r) => r.data),
  });

  const categoryRows = categories?.results ?? categories ?? [];

  const updateFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${basePath}?${params.toString()}`);
  };

  const current = (key: string) => searchParams.get(key) || "";

  return (
    <div className="card p-4 space-y-5 text-sm">
      <h3 className="font-bold text-gray-900">Filters</h3>

      {/* Category */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">Category</h4>
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="category" checked={!current("category")} onChange={() => updateFilter("category", null)} className="text-primary-600" />
            <span>All Categories</span>
          </label>
          {categoryRows.map((cat: any) => (
            <label key={cat.id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="category" value={cat.slug} checked={current("category") === cat.slug} onChange={() => updateFilter("category", cat.slug)} className="text-primary-600" />
              <span>{cat.name}</span>
              <span className="text-gray-400 ml-auto">({cat.product_count})</span>
            </label>
          ))}
        </div>
      </div>

      {/* Price Range */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">Price Range</h4>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            value={current("min_price")}
            onChange={(e) => updateFilter("min_price", e.target.value || null)}
            className="input-field w-full text-xs py-1.5"
            min={0}
          />
          <input
            type="number"
            placeholder="Max"
            value={current("max_price")}
            onChange={(e) => updateFilter("max_price", e.target.value || null)}
            className="input-field w-full text-xs py-1.5"
            min={0}
          />
        </div>
      </div>

      {/* Rating */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">Minimum Rating</h4>
        {[4, 3, 2, 1].map((r) => (
          <label key={r} className="flex items-center gap-2 cursor-pointer mb-1">
            <input type="radio" name="rating" value={r} checked={Number(current("rating")) === r} onChange={() => updateFilter("rating", String(r))} className="text-primary-600" />
            <div className="flex text-amber-400">{"★".repeat(r)}{"☆".repeat(5 - r)}</div>
            <span className="text-gray-500">& up</span>
          </label>
        ))}
      </div>

      {/* Availability */}
      <div>
        <h4 className="font-semibold text-gray-700 mb-2">Availability</h4>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={current("in_stock") === "true"} onChange={(e) => updateFilter("in_stock", e.target.checked ? "true" : null)} className="text-primary-600" />
          <span>In Stock Only</span>
        </label>
      </div>

      {/* Clear */}
      <button onClick={() => router.push(basePath)} className="text-xs text-primary-700 hover:underline">
        Clear all filters
      </button>
    </div>
  );
}
