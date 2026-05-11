"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Search, Shield, ShieldCheck, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  is_staff: boolean;
  is_active: boolean;
  is_email_verified: boolean;
  phone_number: string;
  order_count: number;
  date_joined: string;
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<AdminUser | null>(null);
  const qc = useQueryClient();
  const { user: me } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () =>
      api.get(`/users/admin/users/`, { params: { search: search || undefined } }).then((r) => r.data),
  });

  const promoteMutation = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/admin/users/${userId}/`, { is_staff: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User promoted to admin");
    },
    onError: () => toast.error("Failed to promote user"),
  });

  const demoteMutation = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/admin/users/${userId}/`, { is_staff: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Admin access removed");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.is_staff?.[0] || err?.response?.data?.detail || "Failed to remove admin";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/users/admin/users/${userId}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User deleted");
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.response?.data?.[0] || "Failed to delete user";
      toast.error(msg);
    },
  });

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">User Management</h2>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or name..."
              className="input-field pl-9 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Name", "Email", "Admin", "Phone", "Orders", "Verified", "Status", "Joined", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td>
                </tr>
              ) : (
                data?.results?.map((user: AdminUser) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <span className="inline-flex items-center gap-2">
                        {user.full_name}
                        {user.is_staff && <Shield className="w-3.5 h-3.5 text-primary-600 shrink-0" aria-label="Admin" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${user.is_staff ? "bg-primary-100 text-primary-800" : "bg-gray-100 text-gray-600"}`}>
                        {user.is_staff ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{user.phone_number || "–"}</td>
                    <td className="px-4 py-3 text-gray-700 font-semibold">{user.order_count}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${user.is_email_verified ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {user.is_email_verified ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${user.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {user.is_active ? "Active" : "Suspended"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(user.date_joined)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {!user.is_staff ? (
                          <button
                            type="button"
                            onClick={() => setPromoteTarget(user)}
                            className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap"
                          >
                            Make Admin
                          </button>
                        ) : user.id !== me?.id && (
                          <button
                            type="button"
                            disabled={demoteMutation.isPending && demoteMutation.variables === user.id}
                            onClick={() => demoteMutation.mutate(user.id)}
                            className="text-xs py-1.5 px-3 whitespace-nowrap rounded-lg border border-orange-200 text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-50"
                          >
                            Remove Admin
                          </button>
                        )}
                        {user.id !== me?.id && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(user)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          {data?.count ?? 0} total users
        </div>
      </div>

      {/* Promote confirmation modal */}
      {promoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-100 rounded-full">
                  <ShieldCheck className="w-5 h-5 text-primary-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Grant Admin Access</h3>
              </div>
              <button onClick={() => setPromoteTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-1">
              You are about to grant admin access to:
            </p>
            <p className="font-semibold text-gray-900 mb-1">{promoteTarget.full_name}</p>
            <p className="text-sm text-gray-500 mb-4">{promoteTarget.email}</p>
            <p className="text-xs text-primary-700 bg-primary-50 rounded-lg px-3 py-2 mb-5">
              This user will be able to manage products, orders, and other users in the admin panel.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setPromoteTarget(null)}
                className="flex-1 btn-secondary"
                disabled={promoteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  promoteMutation.mutate(promoteTarget.id);
                  setPromoteTarget(null);
                }}
                disabled={promoteMutation.isPending}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-60"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-full">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Delete User</h3>
              </div>
              <button onClick={() => setDeleteTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-1">
              Are you sure you want to permanently delete:
            </p>
            <p className="font-semibold text-gray-900 mb-1">{deleteTarget.full_name}</p>
            <p className="text-sm text-gray-500 mb-4">{deleteTarget.email}</p>
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-5">
              This will permanently remove the account and all associated data. This cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 btn-secondary"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
