"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import Cookies from "js-cookie";
import api from "@/lib/api";
import { parseApiFieldErrors } from "@/lib/parseApiFieldErrors";
import { useAuthStore } from "@/store/authStore";
import { Eye, EyeOff, Loader2, ShoppingBag } from "lucide-react";

const FIELD_KEYS = [
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "password",
  "password_confirm",
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone_number: "",
    password: "", password_confirm: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<(typeof FIELD_KEYS)[number] | "form", string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const clearFieldError = (field: (typeof FIELD_KEYS)[number]) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.password_confirm) {
      setFieldErrors((prev) => ({
        ...prev,
        password_confirm: "Passwords do not match.",
        password: "Passwords do not match.",
      }));
      toast.error("Passwords do not match");
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register/", form);
      const { user, tokens } = data.data;
      const secure = process.env.NODE_ENV === "production";
      Cookies.set("access_token", tokens.access, { expires: 1, secure, sameSite: "lax" });
      Cookies.set("refresh_token", tokens.refresh, { expires: 7, secure, sameSite: "lax" });
      setUser(user);
      toast.success("Account created! Check your email for a verification code.");
      router.push(`/verify-email?email=${encodeURIComponent(form.email)}`);
    } catch (e: unknown) {
      const res = (e as { response?: { data?: unknown; status?: number } })?.response;
      const body = res?.data;
      const parsed = parseApiFieldErrors(body);
      const next: Partial<Record<(typeof FIELD_KEYS)[number] | "form", string>> = {};

      for (const key of FIELD_KEYS) {
        if (parsed[key]) next[key] = parsed[key]!;
      }
      if (parsed.non_field_errors) next.form = parsed.non_field_errors;
      if (parsed.detail && !next.form) next.form = parsed.detail;

      const legacy = (body as { errors?: { message?: string }[] })?.errors;
      if (legacy?.length && legacy[0]?.message && Object.keys(next).length === 0) {
        next.form = legacy[0].message;
      }

      const msg = (body as { message?: string })?.message;
      if (msg && Object.keys(next).length === 0) next.form = msg;

      setFieldErrors(next);

      const firstInline = FIELD_KEYS.map((k) => next[k]).find(Boolean);
      toast.error(firstInline || next.form || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const update = (field: (typeof FIELD_KEYS)[number]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [field]: e.target.value });
    clearFieldError(field);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-bold text-primary-700">
            <ShoppingBag className="w-8 h-8" /> Mary Kitchen
          </Link>
          <p className="text-gray-500 mt-2">Create your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {fieldErrors.form && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
                {fieldErrors.form}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  required
                  value={form.first_name}
                  onChange={update("first_name")}
                  className={`input-field ${fieldErrors.first_name ? "border-red-500 ring-1 ring-red-200" : ""}`}
                  placeholder="Jane"
                  aria-invalid={!!fieldErrors.first_name}
                />
                {fieldErrors.first_name && <p className="text-xs text-red-600 mt-1">{fieldErrors.first_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  required
                  value={form.last_name}
                  onChange={update("last_name")}
                  className={`input-field ${fieldErrors.last_name ? "border-red-500 ring-1 ring-red-200" : ""}`}
                  placeholder="Smith"
                  aria-invalid={!!fieldErrors.last_name}
                />
                {fieldErrors.last_name && <p className="text-xs text-red-600 mt-1">{fieldErrors.last_name}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={update("email")}
                className={`input-field ${fieldErrors.email ? "border-red-500 ring-1 ring-red-200" : ""}`}
                placeholder="jane@example.com"
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
              {fieldErrors.email?.toLowerCase().includes("already") && (
                <p className="text-xs text-gray-600 mt-1">
                  This email is already registered.{" "}
                  <Link href="/login" className="text-primary-700 font-medium hover:underline">
                    Sign in
                  </Link>{" "}
                  or use{" "}
                  <Link href="/forgot-password" className="text-primary-700 font-medium hover:underline">
                    forgot password
                  </Link>
                  .
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={update("phone_number")}
                className={`input-field ${fieldErrors.phone_number ? "border-red-500 ring-1 ring-red-200" : ""}`}
                placeholder="+61 4XX XXX XXX"
                aria-invalid={!!fieldErrors.phone_number}
              />
              {fieldErrors.phone_number && <p className="text-xs text-red-600 mt-1">{fieldErrors.phone_number}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={form.password}
                  onChange={update("password")}
                  className={`input-field pr-10 ${fieldErrors.password ? "border-red-500 ring-1 ring-red-200" : ""}`}
                  placeholder="Minimum 8 characters"
                  aria-invalid={!!fieldErrors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldErrors.password && <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  value={form.password_confirm}
                  onChange={update("password_confirm")}
                  className={`input-field pr-10 ${fieldErrors.password_confirm ? "border-red-500 ring-1 ring-red-200" : ""}`}
                  placeholder="••••••••"
                  aria-invalid={!!fieldErrors.password_confirm}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldErrors.password_confirm && <p className="text-xs text-red-600 mt-1">{fieldErrors.password_confirm}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:pointer-events-none">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Account
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{" "}
            <Link href="/login" className="text-primary-700 font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
