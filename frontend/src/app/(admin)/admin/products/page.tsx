"use client";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Plus, Search, Edit, Trash2, Star, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import CategoryFilterSelect from "@/components/product/CategoryFilterSelect";
import ConfirmModal, { type ConfirmModalVariant } from "@/components/admin/ConfirmModal";

type ModalState = {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  variant: ConfirmModalVariant;
  onConfirm: () => void;
};

const createClosedModal = (): ModalState => ({
  open: false,
  title: "",
  description: "",
  confirmText: "Confirm",
  cancelText: "Cancel",
  variant: "primary",
  onConfirm: () => {},
});

const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const urlSearch = searchParams.get("search") ?? "";
  const urlCategory = searchParams.get("category") ?? "";
  const [searchInput, setSearchInput] = useState(urlSearch);

  const urlPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const rawPageSize = searchParams.get("page_size");
  const urlPageSize = ALLOWED_PAGE_SIZES.includes(Number(rawPageSize) as (typeof ALLOWED_PAGE_SIZES)[number])
    ? (Number(rawPageSize) as (typeof ALLOWED_PAGE_SIZES)[number])
    : DEFAULT_PAGE_SIZE;

  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  const listQueryKey = useMemo(
    () => ["admin-products", urlSearch, urlCategory, urlPage, urlPageSize] as const,
    [urlSearch, urlCategory, urlPage, urlPageSize]
  );

  const apiQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (urlSearch.trim()) q.set("search", urlSearch.trim());
    if (urlCategory) q.set("category", urlCategory);
    q.set("page", String(urlPage));
    q.set("page_size", String(urlPageSize));
    return `?${q.toString()}`;
  }, [urlSearch, urlCategory, urlPage, urlPageSize]);

  const { data: categoriesData } = useQuery({
    queryKey: ["admin-categories-list"],
    queryFn: () => api.get("/products/admin/categories/").then((r) => r.data.results ?? r.data),
  });
  const categoryRows = categoriesData ?? [];
  const [modal, setModal] = useState<ModalState>(() => createClosedModal());

  const { data, isLoading } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => api.get(`/products/admin/products/${apiQuery}`).then((r) => r.data),
  });

  const closeModal = () => setModal(createClosedModal());

  const showConfirm = (opts: Omit<ModalState, "open">) => setModal({ ...opts, open: true });

  const toggleActive = (id: string, current: boolean, name: string) => {
    showConfirm({
      title: current ? `Deactivate "${name}"?` : `Activate "${name}"?`,
      description: current
        ? "This will hide the product from the store. You can re-activate it any time."
        : "This will make the product visible in the store.",
      confirmText: current ? "Deactivate" : "Activate",
      cancelText: "Cancel",
      variant: current ? "danger" : "primary",
      onConfirm: async () => {
        closeModal();
        try {
          await api.patch(`/products/admin/products/${id}/`, { is_active: !current });
          toast.success(current ? `"${name}" deactivated` : `"${name}" activated`);
          qc.invalidateQueries({ queryKey: ["admin-products"] });
        } catch {
          toast.error("Failed to update status");
        }
      },
    });
  };

  const handleDelete = (id: string, name: string) => {
    showConfirm({
      title: `Delete "${name}"?`,
      description:
        "This action is permanent and cannot be undone. If the product has orders, it will be deactivated instead.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
      onConfirm: async () => {
        closeModal();
        try {
          await api.delete(`/products/admin/products/${id}/`);
          toast.success("Product deleted");
          qc.invalidateQueries({ queryKey: ["admin-products"] });
        } catch (err: any) {
          const status = err?.response?.status;
          const msg = err?.response?.data?.detail || err?.response?.data?.message;
          if (status === 409 || (msg && msg.includes("orders"))) {
            showConfirm({
              title: "Cannot delete — has orders",
              description: `"${name}" is linked to existing orders. Would you like to deactivate it (hide from store) instead?`,
              confirmText: "Deactivate",
              cancelText: "Cancel",
              variant: "warning",
              onConfirm: async () => {
                closeModal();
                await api.patch(`/products/admin/products/${id}/`, { is_active: false });
                toast.success(`"${name}" deactivated`);
                qc.invalidateQueries({ queryKey: ["admin-products"] });
              },
            });
          } else {
            toast.error(msg || "Failed to delete");
          }
        }
      },
    });
  };

  const toggleFeatured = async (id: string, current: boolean) => {
    try {
      await api.patch(`/products/admin/products/${id}/`, { is_featured: !current });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    } catch {}
  };

  const pushListParams = (patch: {
    search?: string;
    category?: string;
    page?: number;
    page_size?: number;
  }) => {
    const nextSearch = patch.search !== undefined ? patch.search : urlSearch;
    const nextCategory = patch.category !== undefined ? patch.category : urlCategory;
    const filtersChanged = patch.search !== undefined || patch.category !== undefined;
    const nextPage =
      patch.page !== undefined ? Math.max(1, patch.page) : filtersChanged ? 1 : urlPage;
    const nextPageSize =
      patch.page_size !== undefined &&
      ALLOWED_PAGE_SIZES.includes(patch.page_size as (typeof ALLOWED_PAGE_SIZES)[number])
        ? patch.page_size
        : urlPageSize;

    const p = new URLSearchParams();
    if (nextSearch.trim()) p.set("search", nextSearch.trim());
    if (nextCategory) p.set("category", nextCategory);
    if (nextPage > 1) p.set("page", String(nextPage));
    if (nextPageSize !== DEFAULT_PAGE_SIZE) p.set("page_size", String(nextPageSize));
    const qs = p.toString();
    router.push(qs ? `/admin/products?${qs}` : "/admin/products");
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushListParams({ search: searchInput });
  };

  const count = data?.count ?? 0;
  const totalPages = Math.max(1, data?.total_pages ?? 1);
  const currentPage = data?.current_page ?? urlPage;
  const results = data?.results ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Products</h2>
        <Link href="/admin/products/new" className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Product
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search products or SKU..."
                className="input-field pl-9 text-sm w-full"
              />
            </div>
            <CategoryFilterSelect
              categories={categoryRows}
              value={urlCategory}
              onChange={(slug) => pushListParams({ category: slug })}
              className="input-field text-sm min-w-[200px] w-full sm:w-auto"
            />
            <button type="submit" className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              Search
            </button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Product", "Category", "Price", "Stock", "Rating", "Active", "Featured", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : results.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">No products found for this filter.</td></tr>
              ) : (
                results.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900 max-w-xs truncate">{p.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.category?.name}</td>
                  <td className="px-4 py-3 font-semibold text-primary-700">{formatCurrency(p.base_price)}</td>
                  <td className="px-4 py-3">
                    <span className={p.stock_quantity === 0 ? "text-red-500 font-bold" : "text-gray-700"}>
                      {p.stock_quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span>{Number(p.average_rating).toFixed(1)}</span>
                      <span className="text-gray-400">({p.review_count})</span>
                    </div>
                  </td>

                  {/* Active toggle */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(p.id, p.is_active, p.name)}
                      title={p.is_active ? "Click to deactivate" : "Click to activate"}
                      className={`w-10 h-5 rounded-full transition-colors ${p.is_active ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white mx-auto transform transition-transform ${p.is_active ? "translate-x-2.5" : "-translate-x-2.5"}`} />
                    </button>
                  </td>

                  {/* Featured toggle */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleFeatured(p.id, p.is_featured)}
                      title={p.is_featured ? "Remove from featured" : "Mark as featured"}
                      className={`w-10 h-5 rounded-full transition-colors ${p.is_featured ? "bg-primary-600" : "bg-gray-300"}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white mx-auto transform transition-transform ${p.is_featured ? "translate-x-2.5" : "-translate-x-2.5"}`} />
                    </button>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/admin/products/${p.id}/edit`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Edit className="w-4 h-4" />
                      </Link>
                      <button onClick={() => handleDelete(p.id, p.name)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && count > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-gray-600">
              Showing {(currentPage - 1) * urlPageSize + 1}–{(currentPage - 1) * urlPageSize + results.length} of{" "}
              <span className="font-medium text-gray-900">{count}</span> product{count !== 1 ? "s" : ""}
              {" · "}
              Page <span className="font-medium text-gray-900">{currentPage}</span> of {totalPages}
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <span>Per page</span>
                <select
                  className="input-field text-sm py-1.5 min-w-[5.5rem]"
                  value={urlPageSize}
                  onChange={(e) => pushListParams({ page_size: Number(e.target.value), page: 1 })}
                >
                  {ALLOWED_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => pushListParams({ page: currentPage - 1 })}
                  className="btn-secondary text-sm py-1.5 px-3 inline-flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                {totalPages <= 15 ? (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {Array.from({ length: totalPages }, (_, i) => {
                      const n = i + 1;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => pushListParams({ page: n })}
                          className={`min-w-[2.25rem] h-9 rounded-lg text-sm font-medium transition-colors ${
                            currentPage === n
                              ? "bg-primary-700 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-sm text-gray-500 px-1">Use Previous / Next to browse pages</span>
                )}
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => pushListParams({ page: currentPage + 1 })}
                  className="btn-secondary text-sm py-1.5 px-3 inline-flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={modal.open}
        title={modal.title}
        description={modal.description}
        confirmText={modal.confirmText}
        cancelText={modal.cancelText}
        variant={modal.variant}
        onConfirm={modal.onConfirm}
        onCancel={closeModal}
      />
    </div>
  );
}
