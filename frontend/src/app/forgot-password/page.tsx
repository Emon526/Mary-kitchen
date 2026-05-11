"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Eye, EyeOff, Loader2, ShoppingBag } from "lucide-react";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/getApiErrorMessage";

type Step = "request" | "confirm";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [requestError, setRequestError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;

    setRequestError("");
    setLoading(true);
    try {
      await api.post("/auth/password/reset/", { email });
      toast.success("If this email exists, a reset code has been sent.");
      setStep("confirm");
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to request reset code.");
      setRequestError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (newPassword !== newPasswordConfirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (code.length !== 6) {
      toast.error("Enter the 6-digit reset code.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/password/reset/confirm/", {
        email,
        code,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm,
      });
      toast.success("Password reset successful. Please sign in.");
      router.push("/login");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to reset password."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-bold text-primary-700">
            <ShoppingBag className="w-8 h-8" /> Mary Kitchen
          </Link>
          <p className="text-gray-500 mt-2">Reset your password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {step === "request" ? (
            <form onSubmit={requestCode} className="space-y-4">
              {requestError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
                  {requestError}
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setRequestError("");
                  }}
                  className={`input-field ${requestError ? "border-red-500 ring-1 ring-red-200" : ""}`}
                  placeholder="you@example.com"
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Send Reset Code
              </button>
            </form>
          ) : (
            <form onSubmit={resetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reset code</label>
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="input-field tracking-[0.3em] text-center text-lg font-semibold"
                  placeholder="000000"
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="Minimum 8 characters"
                    disabled={loading}
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
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    className="input-field pr-10"
                    placeholder="Repeat password"
                    disabled={loading}
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
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Reset Password
              </button>
            </form>
          )}

          <p className="text-center text-sm text-gray-500 mt-5">
            Remember your password?{" "}
            <Link href="/login" className="text-primary-700 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
