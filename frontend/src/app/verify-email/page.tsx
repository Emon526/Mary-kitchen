"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { CheckCircle, Loader2, ShoppingBag } from "lucide-react";
import Cookies from "js-cookie";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/getApiErrorMessage";
import { useAuthStore } from "@/store/authStore";

const RESEND_COOLDOWN = 30;
const REDIRECT_DELAY = 4;

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { fetchProfile } = useAuthStore();

  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verified, setVerified] = useState(false);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_DELAY);

  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectDest = useRef("/");

  useEffect(() => () => { if (resendTimer.current) clearInterval(resendTimer.current); }, []);

  // Countdown + navigation after verification (self-stopping setTimeout chain)
  useEffect(() => {
    if (!verified || redirectIn === 0) return;
    const id = setTimeout(() => setRedirectIn((prev) => prev - 1), 1000);
    return () => clearTimeout(id);
  }, [verified, redirectIn]);

  useEffect(() => {
    if (verified && redirectIn === 0) router.push(redirectDest.current);
  }, [verified, redirectIn, router]);

  const startResendCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN);
    resendTimer.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(resendTimer.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const verify = useCallback(async (verifyCode: string) => {
    if (!email || verifyCode.length !== 6 || loading) return;
    setLoading(true);
    try {
      await api.post("/auth/otp/verify/", { email, code: verifyCode, purpose: "email_verify" });
      const hasToken = !!Cookies.get("access_token");
      if (hasToken) await fetchProfile();
      redirectDest.current = hasToken ? "/" : "/login";
      setVerified(true);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Invalid verification code"));
    } finally {
      setLoading(false);
    }
  }, [email, loading, fetchProfile]);

  const resend = async () => {
    if (!email || resending || resendCooldown > 0) return;
    setResending(true);
    try {
      await api.post("/auth/otp/request/", { email, purpose: "email_verify" });
      toast.success("Verification code sent");
      startResendCooldown();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to send code"));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-2xl font-bold text-primary-700">
            <ShoppingBag className="w-8 h-8" /> Mary Kitchen
          </Link>
          <p className="text-gray-500 mt-2">Verify your email address</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {verified ? (
            <div className="flex flex-col items-center text-center gap-4 py-4">
              <div className="p-3 bg-green-100 rounded-full">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Email Verified!</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Redirecting you home in{" "}
                  <span className="font-semibold text-primary-700">{redirectIn}s</span>…
                </p>
              </div>
              <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
              <button
                type="button"
                onClick={() => router.push(redirectDest.current)}
                className="text-sm text-primary-700 font-medium hover:underline"
              >
                Go now
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={(e) => { e.preventDefault(); verify(code); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field"
                    placeholder="you@example.com"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Verification code
                    <span className="ml-1 text-xs text-gray-400 font-normal">(auto-submits at 6 digits)</span>
                  </label>
                  <input
                    required
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(val);
                      if (val.length === 6) verify(val);
                    }}
                    className="input-field tracking-[0.3em] text-center text-lg font-semibold"
                    placeholder="000000"
                    disabled={loading}
                    autoComplete="one-time-code"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Verify Email
                </button>
              </form>

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={resend}
                  disabled={resending || !email || resendCooldown > 0}
                  className="w-full text-sm font-medium text-primary-700 hover:underline disabled:opacity-50"
                >
                  {resending ? "Sending..." : resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(Cookies.get("access_token") ? "/" : "/login")}
                  className="w-full text-sm text-gray-400 hover:text-gray-600 hover:underline"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
