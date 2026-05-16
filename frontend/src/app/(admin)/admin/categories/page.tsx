"use client";
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import Image from "next/image";
import api from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";
import ConfirmModal from "@/components/admin/ConfirmModal";
import { Plus, Pencil, Trash2, X, Loader2, Tag, AlertTriangle, PackageSearch, CheckSquare } from "lucide-react";

interface InactiveProduct {
  id: string;
  name: string;
  sku: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
  parent: string | null;
  image?: string | null;
  image_url?: string | null;
}

const emptyForm = { name: "", description: "", is_active: true, parent: "" };

export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [reactivationCategoryId, setReactivationCategoryId] = useState<string | null>(null);
  const [reactivationProducts, setReactivationProducts] = useState<InactiveProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [activating, setActivating] = useState(false);

  const { data: categories, isLoading } = useQuery({
    queryKey: ["admin-categories-list"],
    queryFn: () => api.get("/products/admin/categories/").then((r) => r.data.results ?? r.data),
  });

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setImageFile(null);
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setShowModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setForm({ name: cat.name, description: cat.description, is_active: cat.is_active, parent: cat.parent ?? "" });
    setImageFile(null);
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    const existing = absoluteMediaUrl(cat.image_url ?? cat.image ?? null);
    setImagePreview(existing);
    setShowModal(true);
  };

  const closeModal = () => {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageFile(null);
    setShowModal(false);
    setEditing(null);
  };

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
    e.target.value = "";
  };

  const clearPickedImage = () => {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    if (editing) {
      const existing = absoluteMediaUrl(editing.image_url ?? editing.image ?? null);
      setImagePreview(existing);
    } else {
      setImagePreview(null);
    }
  };

  const buildFormData = () => {
    const fd = new FormData();
    fd.append("name", form.name.trim());
    fd.append("description", form.description);
    fd.append("is_active", form.is_active ? "true" : "false");
    if (form.parent) fd.append("parent", form.parent);
    if (imageFile) fd.append("image", imageFile);
    return fd;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    setLoading(true);
    try {
      if (editing) {
        const wasActive = editing.is_active;
        const isReactivating = !wasActive && form.is_active;
        if (imageFile) {
          await api.patch(`/products/admin/categories/${editing.id}/`, buildFormData());
        } else {
          await api.patch(`/products/admin/categories/${editing.id}/`, {
            ...form,
            parent: form.parent || null,
          });
        }
        qc.invalidateQueries({ queryKey: ["admin-categories-list"] });
        qc.invalidateQueries({ queryKey: ["admin-categories"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
        closeModal();
        if (wasActive && !form.is_active) {
          toast("Category disabled — all products in it are now hidden from the store.", { icon: "⚠️" });
        } else if (isReactivating) {
          const { data } = await api.get(`/products/admin/categories/${editing.id}/inactive-products/`);
          if (data.length > 0) {
            setReactivationProducts(data);
            setSelectedProductIds(data.map((p: InactiveProduct) => p.id));
            setReactivationCategoryId(editing.id);
          } else {
            toast.success("Category reactivated!");
          }
        } else {
          toast.success("Category updated!");
        }
      } else {
        if (imageFile) {
          await api.post("/products/admin/categories/", buildFormData());
        } else {
          await api.post("/products/admin/categories/", { ...form, parent: form.parent || null });
        }
        toast.success("Category created!");
        qc.invalidateQueries({ queryKey: ["admin-categories-list"] });
        qc.invalidateQueries({ queryKey: ["admin-categories"] });
        qc.invalidateQueries({ queryKey: ["categories"] });
        closeModal();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || "Failed to save category");
    } finally {
      setLoading(false);
    }
  };

  const requestDeleteCategory = (cat: Category) => setPendingDelete(cat);

  const confirmCategoryDelete = async () => {
    if (!pendingDelete) return;
    const cat = pendingDelete;
    setPendingDelete(null);
    try {
      await api.delete(`/products/admin/categories/${cat.id}/`);
      toast.success("Category deleted");
      qc.invalidateQueries({ queryKey: ["admin-categories-list"] });
      qc.invalidateQueries({ queryKey: ["admin-categories"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.response?.data?.errors?.[0]?.message ||
        "Failed to delete category";
      toast.error(msg);
    }
  };

  const closeReactivationModal = () => {
    setReactivationCategoryId(null);
    setReactivationProducts([]);
    setSelectedProductIds([]);
  };

  const toggleProductSelection = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleActivateProducts = async (activateAll: boolean) => {
    if (!reactivationCategoryId) return;
    setActivating(true);
    try {
      const body = activateAll
        ? { activate_all: true }
        : { product_ids: selectedProductIds };
      const { data } = await api.post(
        `/products/admin/categories/${reactivationCategoryId}/activate-products/`,
        body
      );
      toast.success(`${data.activated} product${data.activated !== 1 ? "s" : ""} reactivated!`);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      closeReactivationModal();
    } catch {
      toast.error("Failed to activate products");
    } finally {
      setActivating(false);
    }
  };

  const rootCategories = categories?.filter((c: Category) => !c.parent) ?? [];
  const subCategories = categories?.filter((c: Category) => c.parent) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Categories</h2>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Category
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-full" />
            </div>
          ))}
        </div>
      ) : categories?.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-16 text-center">
          <Tag className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No categories yet</p>
          <p className="text-sm text-gray-400 mt-1">Create your first category to organise products</p>
          <button onClick={openCreate} className="btn-primary mt-4 text-sm">Create Category</button>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Root Categories ({rootCategories.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rootCategories.map((cat: Category) => (
                <CategoryCard key={cat.id} cat={cat} onEdit={openEdit} onDelete={requestDeleteCategory} />
              ))}
            </div>
          </div>

          {subCategories.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Sub-categories ({subCategories.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {subCategories.map((cat: Category) => (
                  <CategoryCard key={cat.id} cat={cat} onEdit={openEdit} onDelete={requestDeleteCategory} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">{editing ? "Edit Category" : "New Category"}</h3>
              <button type="button" onClick={closeModal} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Image</label>
                <div className="flex items-start gap-4">
                  <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 flex-shrink-0">
                    {imagePreview ? (
                      <Image src={imagePreview} alt="" fill className="object-cover" unoptimized={imagePreview.startsWith("blob:")} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Tag className="w-8 h-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 text-sm">
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onPickImage} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary text-xs py-1.5 px-3 w-fit">
                      {imagePreview ? "Change image" : "Upload image"}
                    </button>
                    {imageFile && (
                      <button type="button" onClick={clearPickedImage} className="text-xs text-gray-500 hover:text-gray-800 w-fit">
                        Discard new upload
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">Optional. Shown on the storefront category grid.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Fresh Produce"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="input-field resize-none"
                  placeholder="Optional description..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parent Category (optional)</label>
                <select
                  value={form.parent}
                  onChange={(e) => setForm({ ...form, parent: e.target.value })}
                  className="input-field"
                >
                  <option value="">None (root category)</option>
                  {rootCategories
                    .filter((c: Category) => c.id !== editing?.id)
                    .map((c: Category) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="w-4 h-4 accent-primary-600"
                  />
                  <span className="text-sm text-gray-700">Active (visible in store)</span>
                </label>
                {editing?.is_active && !form.is_active && (
                  <div className="flex items-start gap-2 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      Disabling this category will also hide <strong>all products</strong> in it from the store.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? "Save Changes" : "Create Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingDelete != null}
        title={pendingDelete ? `Delete "${pendingDelete.name}"?` : ""}
        description="This will permanently delete the category. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmCategoryDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {reactivationCategoryId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-primary-50 rounded-xl flex items-center justify-center">
                  <PackageSearch className="w-5 h-5 text-primary-700" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Reactivate Products?</h3>
                  <p className="text-xs text-gray-500">{reactivationProducts.length} disabled product{reactivationProducts.length !== 1 ? "s" : ""} in this category</p>
                </div>
              </div>
              <button type="button" onClick={closeReactivationModal} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {reactivationProducts.map((product) => {
                const checked = selectedProductIds.includes(product.id);
                return (
                  <label
                    key={product.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      checked ? "border-primary-300 bg-primary-50" : "border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProductSelection(product.id)}
                      className="w-4 h-4 accent-primary-600 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                      <p className="text-xs text-gray-400">{product.sku}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="p-4 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{selectedProductIds.length} of {reactivationProducts.length} selected</span>
                <button
                  type="button"
                  className="text-xs text-primary-600 hover:underline"
                  onClick={() =>
                    setSelectedProductIds(
                      selectedProductIds.length === reactivationProducts.length
                        ? []
                        : reactivationProducts.map((p) => p.id)
                    )
                  }
                >
                  {selectedProductIds.length === reactivationProducts.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <button
                type="button"
                disabled={activating}
                onClick={() => handleActivateProducts(true)}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                Activate All ({reactivationProducts.length})
              </button>
              <button
                type="button"
                disabled={activating || selectedProductIds.length === 0}
                onClick={() => handleActivateProducts(false)}
                className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Activate Selected ({selectedProductIds.length})
              </button>
              <button
                type="button"
                onClick={closeReactivationModal}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-2 text-center"
              >
                Skip — keep them hidden
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryCard({ cat, onEdit, onDelete }: { cat: Category; onEdit: (c: Category) => void; onDelete: (c: Category) => void }) {
  const thumb = absoluteMediaUrl(cat.image_url ?? cat.image ?? null);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex gap-3">
      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-100">
        {thumb ? (
          <Image src={thumb} alt="" fill className="object-cover" sizes="64px" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <Tag className="w-6 h-6" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-gray-900 truncate">{cat.name}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cat.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              {cat.is_active ? "Active" : "Hidden"}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">/slug: {cat.slug}</p>
          {cat.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{cat.description}</p>}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button type="button" onClick={() => onEdit(cat)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
            <Pencil className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onDelete(cat)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
