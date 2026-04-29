"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import ConfirmModal from "@/components/admin/ConfirmModal";
import { Plus, Edit, Trash2, Truck } from "lucide-react";

export default function AdminDeliveryPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", min_distance_km: "", max_distance_km: "",
    delivery_fee: "", free_delivery_threshold: "",
    estimated_delivery_days: "1", is_active: true,
    outside_zone_behaviour: "deny",
  });
  const [pendingZoneDelete, setPendingZoneDelete] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-delivery-zones"],
    queryFn: () => api.get("/delivery/admin/zones/").then((r) => r.data),
  });

  const resetForm = () => {
    setForm({ name: "", min_distance_km: "", max_distance_km: "", delivery_fee: "", free_delivery_threshold: "", estimated_delivery_days: "1", is_active: true, outside_zone_behaviour: "deny" });
    setEditing(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const min = parseFloat(String(form.min_distance_km).trim());
    const max = parseFloat(String(form.max_distance_km).trim());
    if (Number.isNaN(min) || Number.isNaN(max)) {
      toast.error("Min and max distance must be valid numbers");
      return;
    }
    if (min >= max) {
      toast.error("Min distance must be less than max distance");
      return;
    }
    try {
      if (editing) {
        await api.patch(`/delivery/admin/zones/${editing.id}/`, form);
        toast.success("Zone updated!");
      } else {
        await api.post("/delivery/admin/zones/", form);
        toast.success("Zone created!");
      }
      qc.invalidateQueries({ queryKey: ["admin-delivery-zones"] });
      setShowForm(false);
      resetForm();
    } catch {
      toast.error("Failed to save zone");
    }
  };

  const handleEdit = (zone: any) => {
    setEditing(zone);
    setForm({
      ...zone,
      min_distance_km: zone.min_distance_km != null && zone.min_distance_km !== "" ? String(zone.min_distance_km) : "",
      max_distance_km: zone.max_distance_km != null && zone.max_distance_km !== "" ? String(zone.max_distance_km) : "",
      delivery_fee: zone.delivery_fee != null && zone.delivery_fee !== "" ? String(zone.delivery_fee) : "",
      free_delivery_threshold: zone.free_delivery_threshold || "",
      estimated_delivery_days: String(zone.estimated_delivery_days ?? 1),
    });
    setShowForm(true);
  };

  const requestDeleteZone = (zone: { id: string; name: string }) =>
    setPendingZoneDelete({ id: zone.id, name: zone.name });

  const confirmDeleteZone = async () => {
    if (!pendingZoneDelete) return;
    const { id, name } = pendingZoneDelete;
    setPendingZoneDelete(null);
    try {
      await api.delete(`/delivery/admin/zones/${id}/`);
      qc.invalidateQueries({ queryKey: ["admin-delivery-zones"] });
      toast.success(`"${name}" deleted`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        "Failed to delete";
      toast.error(msg);
    }
  };

  const zones = data?.results || data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Delivery Zones</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Add Zone
        </button>
      </div>

      {/* Zones Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {zones.map((zone: any) => (
          <div key={zone.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">{zone.name}</h3>
              </div>
              <span className={`badge ${zone.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {zone.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="text-sm text-gray-600 space-y-1 mb-4">
              <p>Distance: {zone.min_distance_km}–{zone.max_distance_km} km</p>
              <p>Fee: <span className="font-semibold text-primary-700">{formatCurrency(zone.delivery_fee)}</span></p>
              {zone.free_delivery_threshold && (
                <p className="text-green-600">Free over {formatCurrency(zone.free_delivery_threshold)}</p>
              )}
              <p>Est. {zone.estimated_delivery_days} day(s)</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(zone)} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
                <Edit className="w-3 h-3" /> Edit
              </button>
              <button onClick={() => requestDeleteZone(zone)} className="text-xs text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">{editing ? "Edit Zone" : "Add Delivery Zone"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="e.g. Darwin CBD" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Distance (km)</label>
                  <input
                    type="number"
                    required
                    value={form.min_distance_km}
                    onChange={(e) => setForm({ ...form, min_distance_km: e.target.value })}
                    className="input-field"
                    min={0}
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Distance (km)</label>
                  <input
                    type="number"
                    required
                    value={form.max_distance_km}
                    onChange={(e) => setForm({ ...form, max_distance_km: e.target.value })}
                    className="input-field"
                    min={0}
                    step="0.01"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Fee ($)</label>
                  <input type="number" required value={form.delivery_fee} onChange={(e) => setForm({ ...form, delivery_fee: e.target.value })} className="input-field" min={0} step="0.01" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Free Over ($, optional)</label>
                  <input type="number" value={form.free_delivery_threshold} onChange={(e) => setForm({ ...form, free_delivery_threshold: e.target.value })} className="input-field" min={0} step="0.01" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Est. Delivery Days</label>
                <input type="number" value={form.estimated_delivery_days} onChange={(e) => setForm({ ...form, estimated_delivery_days: e.target.value })} className="input-field" min={1} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Outside Zone Behaviour</label>
                <select value={form.outside_zone_behaviour} onChange={(e) => setForm({ ...form, outside_zone_behaviour: e.target.value })} className="input-field">
                  <option value="deny">Deny delivery</option>
                  <option value="allow">Allow with extra charge</option>
                  <option value="contact">Contact for quote</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                <span className="text-sm text-gray-700">Active</span>
              </label>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">{editing ? "Update" : "Create"} Zone</button>
                <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="btn-secondary flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmModal
        open={pendingZoneDelete != null}
        title={pendingZoneDelete ? `Delete "${pendingZoneDelete.name}"?` : ""}
        description="This action is permanent and cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteZone}
        onCancel={() => setPendingZoneDelete(null)}
      />
    </div>
  );
}
