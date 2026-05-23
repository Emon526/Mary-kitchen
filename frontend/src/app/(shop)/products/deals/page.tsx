"use client";
import { Suspense } from "react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import ProductCard from "@/components/product/ProductCard";
import ProductFilters from "@/components/product/ProductFilters";
import CategoryFilterSelect from "@/components/product/CategoryFilterSelect";
import { Skeleton } from "@/components/ui/Skeleton";
import { Search, SlidersHorizontal, Tag } from "lucide-react";

function DealsPageInner() {
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

  const qs = params.toString();
  const dealsUrl = qs ? `/products/deals/?${qs}` : "/products/deals/";

  const { data, isLoading, error } = useQuery({
    queryKey: ["products-deals", qs],
    queryFn: async () => {
      const r = await api.get(dealsUrl);
      const body = r.data;
      if (process.env.NODE_ENV === "development") {
        console.debug("[/products/deals/]", { count: body?.count, page: body?.current_page, results: body?.results?.length });
      }
      return body;
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const newParams = new URLSearchParams(searchParams.toString());
    if (search) newParams.set("search", search);
    else newParams.delete("search");
    newParams.delete("page");
    router.push(`/products/deals?${newParams.toString()}`);
  };

  const handlePageChange = (page: number) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set("page", String(page));
    router.push(`/products/deals?${newParams.toString()}`);
  };

  const setCategoryFilter = (slug: string) => {
    const newParams = new URLSearchParams(searchParams.toString());
    if (slug) newParams.set("category", slug);
    else newParams.delete("category");
    newParams.delete("page");
    router.push(`/products/deals?${newParams.toString()}`);
  };

  return (
    <div className="container-xl py-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <Tag className="w-5 h-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Special offers</span>
          </div>
          <h1 className="section-title">Deals</h1>
          <p className="text-sm text-gray-600 mt-1 max-w-xl">
            Products with an active discount — compare at the crossed-out price, pay the sale price.
          </p>
        </div>
        <Link href="/products" className="text-sm text-primary-700 hover:underline font-medium self-start sm:self-auto">
          Browse all products
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals..."
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
          className="btn-secondary flex items-center gap-2"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
      </div>

      <div className="flex gap-6">
        {showFilters && (
          <div className="w-64 flex-shrink-0">
            <ProductFilters basePath="/products/deals" />
          </div>
        )}

        <div className="flex-1">
          {activeCategoryName && (
            <p className="text-sm font-medium text-gray-800 mb-3">
              Showing: <span className="text-primary-700">{activeCategoryName}</span>
            </p>
          )}
          {data && (
            <p className="text-sm text-gray-500 mb-4">
              {data.count} deal{data.count !== 1 ? "s" : ""} available
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3 mb-4">
              Could not load deals. Check that the API is running and <code className="text-xs">NEXT_PUBLIC_API_URL</code> points to <code className="text-xs">…/api/v1</code>.
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </div>
          ) : data?.results?.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Tag className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">No deals right now</p>
              <p className="text-sm">Check back soon — or browse all products.</p>
              <Link href="/products" className="btn-primary inline-flex mt-6">All products</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

export default function DealsPage() {
  return (
    <Suspense
      fallback={
        <div className="container-xl py-8">
          {/* Header skeleton */}
          <div className="flex justify-between mb-6">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-8 w-24 rounded" />
              <Skeleton className="h-4 w-64 rounded" />
            </div>
            <Skeleton className="h-4 w-32 rounded self-end" />
          </div>
          {/* Search bar skeleton */}
          <div className="flex gap-4 mb-6">
            <Skeleton className="h-10 flex-1 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
          {/* Products grid skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-72 rounded-xl" />
            ))}
          </div>
        </div>
      }
    >
      <DealsPageInner />
    </Suspense>
  );
}