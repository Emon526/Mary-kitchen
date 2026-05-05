"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useCartStore } from "@/store/cartStore";
import { CheckCircle, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const fetchCart = useCartStore((s) => s.fetchCart);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setStatus("error");
      setMessage("Missing checkout session. Please return to checkout and try again.");
      return;
    }

    let cancelled = false;

    const verifyCheckout = async () => {
      const maxAttempts = 4;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const res = await api.get("/payments/checkout-session/", { params: { session_id: sessionId } });
          const body = res.data;
          if (!body.success) {
            throw { response: { status: 400, data: body } };
          }

          if (cancelled) return;
          setOrderNumber(body.data.order_number);
          setStatus("ok");
          void fetchCart();
          return;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts) {
            await new Promise((resolve) => window.setTimeout(resolve, attempt * 1000));
          }
        }
      }

      if (cancelled) return;
      const statusCode = lastError?.response?.status;
      const serverMessage = lastError?.response?.data?.message;
      setStatus("error");
      setMessage(
        serverMessage ||
          (statusCode
            ? `Payment succeeded, but verification returned ${statusCode}. Please view your orders.`
            : "Payment succeeded, but we could not reach the verification API. Please view your orders.")
      );
      void fetchCart();
    };

    void verifyCheckout();

    return () => {
      cancelled = true;
    };
  }, [fetchCart]);

  if (status === "loading") {
    return (
      <div className="container-xl py-16 max-w-lg mx-auto text-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary-600 mx-auto" />
        <p className="text-gray-600 text-sm">Confirming your payment…</p>
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="container-xl py-16 max-w-lg mx-auto text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Could not confirm checkout</h1>
        <p className="text-gray-600 text-sm">{message}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href="/checkout" className="btn-primary inline-flex justify-center">
            Back to checkout
          </Link>
          <Link href="/orders" className="btn-secondary inline-flex justify-center">
            View orders
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-xl py-16 max-w-lg mx-auto text-center space-y-6">
      <div className="flex justify-center">
        <div className="rounded-full bg-green-100 p-4">
          <CheckCircle className="w-12 h-12 text-green-600" />
        </div>
      </div>
      <h1 className="section-title">Thank you!</h1>
      <p className="text-gray-600">
        Your payment was processed on Stripe&apos;s secure checkout. Order{" "}
        <span className="font-semibold text-gray-900">#{orderNumber}</span> is confirmed.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
        <Link href={orderNumber ? `/orders/${encodeURIComponent(orderNumber)}` : "/orders"} className="btn-primary inline-flex justify-center">
          View order
        </Link>
        <button type="button" onClick={() => router.push("/products")} className="btn-secondary">
          Continue shopping
        </button>
      </div>
    </div>
  );
}
