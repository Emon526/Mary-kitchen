"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Camera, Globe, MapPin, Phone, Mail, Clock, Facebook, Instagram, Store, X } from "lucide-react";
import { type StoreProfile, STORE_PROFILE_PUBLIC_KEY } from "@/hooks/useStoreProfile";

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = Omit<StoreProfile, "id" | "updated_at" | "logo_url">;

type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
type DaySchedule = { open: boolean; from: string; to: string };
type WeekSchedule = Record<DayKey, DaySchedule>;

// ─── Constants ────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormState = {
  name: "", tagline: "", email: "", phone: "",
  address: "", suburb: "", state: "", postcode: "",
  latitude: null, longitude: null,
  description: "", opening_hours: "",
  website: "", facebook: "", instagram: "",
};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const isCoord = (f: keyof FormState) => f === "latitude" || f === "longitude";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

const DEFAULT_SCHEDULE: WeekSchedule = {
  monday:    { open: true,  from: "09:00", to: "17:00" },
  tuesday:   { open: true,  from: "09:00", to: "17:00" },
  wednesday: { open: true,  from: "09:00", to: "17:00" },
  thursday:  { open: true,  from: "09:00", to: "17:00" },
  friday:    { open: true,  from: "09:00", to: "17:00" },
  saturday:  { open: true,  from: "10:00", to: "15:00" },
  sunday:    { open: false, from: "10:00", to: "14:00" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function parse12to24(time12: string): string {
  const match = time12.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return "09:00";
  let h = parseInt(match[1]);
  const m = match[2];
  if (match[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (match[3].toUpperCase() === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

function scheduleToString(s: WeekSchedule): string {
  return DAYS.map(({ key, label }) =>
    s[key].open ? `${label}: ${fmt12(s[key].from)} – ${fmt12(s[key].to)}` : `${label}: Closed`
  ).join("\n");
}

function parseSchedule(str: string): WeekSchedule {
  const result: WeekSchedule = { ...DEFAULT_SCHEDULE };
  for (const line of str.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const dayName = line.slice(0, colonIdx).trim();
    const timePart = line.slice(colonIdx + 1).trim();
    const entry = DAYS.find((d) => d.label === dayName);
    if (!entry) continue;
    if (timePart === "Closed") {
      result[entry.key] = { ...result[entry.key], open: false };
    } else {
      const parts = timePart.split(" – ");
      if (parts.length === 2) {
        result[entry.key] = { open: true, from: parse12to24(parts[0]), to: parse12to24(parts[1]) };
      }
    }
  }
  return result;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <div className="p-1.5 bg-primary-50 rounded-lg">
        <Icon className="w-4 h-4 text-primary-600" />
      </div>
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-checked={on}
      role="switch"
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${on ? "bg-primary-600" : "bg-gray-200"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

const ALL_DAY_SCHEDULE = Object.fromEntries(
  DAYS.map(({ key }) => [key, { open: true, from: "00:00", to: "23:59" }])
) as WeekSchedule;

function is24_7(s: WeekSchedule): boolean {
  return DAYS.every(({ key }) => s[key].open && s[key].from === "00:00" && s[key].to === "23:59");
}

function OpeningHoursEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const initial = value ? parseSchedule(value) : DEFAULT_SCHEDULE;
  const [schedule, setSchedule] = useState<WeekSchedule>(initial);
  const customRef = useRef<WeekSchedule>(is24_7(initial) ? DEFAULT_SCHEDULE : initial);

  const allDay = is24_7(schedule);

  const update = (key: DayKey, patch: Partial<DaySchedule>) => {
    setSchedule((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } };
      onChange(scheduleToString(next));
      return next;
    });
  };

  const enableAllDay = () => {
    customRef.current = schedule;
    setSchedule(ALL_DAY_SCHEDULE);
    onChange(scheduleToString(ALL_DAY_SCHEDULE));
  };

  const disableAllDay = () => {
    const next = customRef.current;
    setSchedule(next);
    onChange(scheduleToString(next));
  };

  if (allDay) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-green-800">Open 24/7</p>
            <p className="text-xs text-green-600 mt-0.5">Open all day, every day of the week</p>
          </div>
        </div>
        <button
          type="button"
          onClick={disableAllDay}
          className="flex-shrink-0 text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors"
        >
          Set custom hours
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400">Toggle days on/off and set open/close times.</p>
        <button
          type="button"
          onClick={enableAllDay}
          className="text-xs font-semibold text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-300 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Set 24/7
        </button>
      </div>
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
        {DAYS.map(({ key, label }) => {
          const day = schedule[key];
          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-4 py-3 transition-colors ${day.open ? "bg-white" : "bg-gray-50"}`}
            >
              <Toggle on={day.open} onChange={() => update(key, { open: !day.open })} />
              <span className={`w-28 text-sm font-medium flex-shrink-0 ${day.open ? "text-gray-800" : "text-gray-400"}`}>
                {label}
              </span>
              {day.open ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="time"
                    value={day.from}
                    onChange={(e) => update(key, { from: e.target.value })}
                    className="input-field py-1.5 text-sm w-32"
                  />
                  <span className="text-gray-400 text-sm flex-shrink-0">to</span>
                  <input
                    type="time"
                    value={day.to}
                    onChange={(e) => update(key, { to: e.target.value })}
                    className="input-field py-1.5 text-sm w-32"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400 italic">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const { isLoading, data: profileData } = useQuery<StoreProfile>({
    queryKey: ["store-profile"],
    queryFn: () => api.get("/store/admin/profile/").then((r) => r.data),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!profileData) return;
    setForm({
      name: profileData.name ?? "",
      tagline: profileData.tagline ?? "",
      email: profileData.email ?? "",
      phone: profileData.phone ?? "",
      address: profileData.address ?? "",
      suburb: profileData.suburb ?? "",
      state: profileData.state ?? "",
      postcode: profileData.postcode ?? "",
      latitude: profileData.latitude ?? null,
      longitude: profileData.longitude ?? null,
      description: profileData.description ?? "",
      opening_hours: profileData.opening_hours ?? "",
      website: profileData.website ?? "",
      facebook: profileData.facebook ?? "",
      instagram: profileData.instagram ?? "",
    });
    if (profileData.logo_url) setLogoPreview(profileData.logo_url);
  }, [profileData]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      (Object.keys(form) as Array<keyof FormState>).forEach((key) => {
        const val = form[key];
        if (val !== null && val !== undefined) fd.append(key, String(val));
      });
      if (logoFile) fd.append("logo", logoFile);
      if (removeLogo) fd.append("remove_logo", "true");
      return api.patch("/store/admin/profile/", fd);
    },
    onSuccess: (response) => {
      qc.setQueryData(["store-profile"], response.data);
      qc.setQueryData(STORE_PROFILE_PUBLIC_KEY, response.data);
      setLogoFile(null);
      setRemoveLogo(false);
      toast.success("Store profile saved");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Failed to save store profile");
    },
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be smaller than 5 MB");
      e.target.value = "";
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setLogoFile(file);
    setLogoPreview(url);
    setRemoveLogo(false);
  };

  const handleRemoveLogo = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
  };

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value !== "" ? e.target.value : (isCoord(field) ? null : "") }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading store settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Store Settings</h2>
        <p className="text-sm text-gray-500 mt-1">Manage your store profile, contact details, and social links.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Brand */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={Store} title="Brand" />
          <div className="flex items-start gap-6">
            <div className="flex-shrink-0 text-center">
              <div className="relative inline-block">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload store logo"
                  className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary-400 transition-colors relative group"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                >
                  {logoPreview ? (
                    <Image
                      src={logoPreview}
                      alt="Store logo"
                      fill
                      className="object-cover"
                      unoptimized={logoPreview.startsWith("blob:")}
                    />
                  ) : (
                    <Store className="w-8 h-8 text-gray-300" />
                  )}
                  <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                </div>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    aria-label="Remove logo"
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow transition-colors z-10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleLogoChange} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium">
                {logoPreview ? "Change Logo" : "Upload Logo"}
              </button>
              <p className="text-xs text-gray-400 mt-0.5">Max 5 MB</p>
            </div>

            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store Name <span className="text-red-500">*</span>
                </label>
                <input required maxLength={200} value={form.name} onChange={set("name")} className="input-field" placeholder="Mary Kitchen" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
                <input maxLength={300} value={form.tagline} onChange={set("tagline")} className="input-field" placeholder="Fresh groceries delivered to your door" />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={set("description")} rows={3} className="input-field resize-none" placeholder="Tell customers about your store..." />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={Phone} title="Contact" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</span>
              </label>
              <input type="email" value={form.email} onChange={set("email")} className="input-field" placeholder="hello@marykitchen.com.au" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</span>
              </label>
              <input type="tel" value={form.phone} onChange={set("phone")} className="input-field" placeholder="+61 449 529 923" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Website</span>
              </label>
              <input type="url" value={form.website} onChange={set("website")} className="input-field" placeholder="https://marykitchen.com.au" />
            </div>
          </div>
        </div>

        {/* Opening Hours */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={Clock} title="Opening Hours" />
          <OpeningHoursEditor
            key={profileData?.updated_at ?? "empty"}
            value={form.opening_hours}
            onChange={(v) => setForm((prev) => ({ ...prev, opening_hours: v }))}
          />
        </div>

        {/* Address */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={MapPin} title="Address" />
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
              <textarea value={form.address} onChange={set("address")} rows={2} className="input-field resize-none" placeholder="8/63 Winnellie Rd" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Suburb</label>
                <input value={form.suburb} onChange={set("suburb")} className="input-field" placeholder="Darwin" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input value={form.state} onChange={set("state")} className="input-field" placeholder="NT" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label>
                <input value={form.postcode} onChange={set("postcode")} className="input-field" placeholder="0800" />
              </div>
            </div>
          </div>
        </div>

        {/* Location Coordinates */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={MapPin} title="Location Coordinates" />
          <p className="text-xs text-gray-400 -mt-2 mb-4">Used for delivery distance calculation. Leave blank to use environment variable defaults.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input type="number" step="0.000001" min="-90" max="90" value={form.latitude ?? ""} onChange={set("latitude")} className="input-field" placeholder="-12.463400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input type="number" step="0.000001" min="-180" max="180" value={form.longitude ?? ""} onChange={set("longitude")} className="input-field" placeholder="130.845600" />
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle icon={Globe} title="Social Links" />
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5"><Facebook className="w-3.5 h-3.5" /> Facebook</span>
              </label>
              <input type="url" value={form.facebook} onChange={set("facebook")} className="input-field" placeholder="https://facebook.com/marykitchen" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <span className="flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5" /> Instagram</span>
              </label>
              <input type="url" value={form.instagram} onChange={set("instagram")} className="input-field" placeholder="https://instagram.com/marykitchen" />
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end pb-2">
          <button type="submit" disabled={saveMutation.isPending} className="btn-primary px-8 disabled:opacity-60">
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
