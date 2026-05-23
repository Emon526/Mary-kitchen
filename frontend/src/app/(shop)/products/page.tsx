"use client";
import { Suspense } from "react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import ProductCard from "@/components/product/ProductCard";
import ProductFilters from "@/components/product/ProductFilters";
import CategoryFilterSelect from "@/components/product/CategoryFilterSelect";
import { Skeleton } from "@/components/ui/Skeleton";
import { Search, SlidersHorizontal } from "lucide-react";

function ProductsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const categorySlug = searchParams.get("category") || "";
  const [search, setSearch] = useState(searchParams.get("search") || "");

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
  }, [searchParams]);

  const params = new URLSearchParams(searchParams.toString());

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/products/categories/").then((r) => r.data),
  });

  const categoryRows = categoriesData?.results ?? categoriesData ?? [];
  const activeCategoryName = useMemo(() => {
    if (!categorySlug) return null;
    const row = categoryRows.find((c: { slug: string }) => c.slug === categorySlug);
    return row?.name ?? null;
  }, [categorySlug, categoryRows]);

  const { data, isLoading } = useQuery({
    queryKey: ["products", params.toString()],
    queryFn: () => api.get(`/products/?${params.toString()}`).then((r) => r.data),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const newParams = new URLSearchParams(searchParams.toString());
    if (search) newParams.set("search", search);
    else newParams.delete("search");
    newParams.delete("page");
    router.push(`/products?${newParams.toString()}`);
  };

  const handlePageChange = (page: number) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set("page", String(page));
    router.push(`/products?${newParams.toString()}`);
  };

  const setCategoryFilter = (slug: string) => {
    const newParams = new URLSearchParams(searchParams.toString());
    if (slug) newParams.set("category", slug);
    else newParams.delete("category");
    newParams.delete("page");
    router.push(`/products?${newParams.toString()}`);
  };

  return (
    <div className="container-xl py-8">
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="input-field pl-10"
            />
          </div>
          <button type="submit" className="btn-primary px-5">Search</button>
          <CategoryFilterSelect
            categories={categoryRows}
            value={categorySlug}
            onChange={setCategoryFilter}
            className="input-field text-sm min-w-[200px] w-full sm:w-auto"
          />
        </form>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-secondary flex items-center gap-2 self-start"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
      </div>

      {activeCategoryName && (
        <p className="text-sm font-medium text-gray-800 mb-4">
          Showing: <span className="text-primary-700">{activeCategoryName}</span>
        </p>
      )}

      <div className="flex gap-6">
        {showFilters && (
          <div className="w-64 flex-shrink-0">
            <ProductFilters />
          </div>
        )}

        <div className="flex-1">
          {data && (
            <p className="text-sm text-gray-500 mb-4">
              {data.count} product{data.count !== 1 ? "s" : ""} found
            </p>
          )}

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-60 rounded-xl" />
              ))}
            </div>
          ) : data?.results?.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Search className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">No products found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {data?.results?.map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              {data?.total_pages > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  {Array.from({ length: data.total_pages }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => handlePageChange(i + 1)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        data.current_page === i + 1
                          ? "bg-primary-700 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="container-xl py-8">
          {/* Search bar skeleton */}
          <div className="flex gap-4 mb-6">
            <Skeleton className="h-10 flex-1 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
          {/* Products grid skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        </div>
      }
    >
      <ProductsPageInner />
    </Suspense>
  );
}