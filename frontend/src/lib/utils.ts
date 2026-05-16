import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(amount));
}

/**
 * Discount % from original (compare) and sale price, matching backend:
 * (compare - sale) / compare * 100, rounded down to int. Use API fields when possible.
 */
export function productDiscountPercentFromPrices(
  salePrice: number | string | null | undefined,
  compareAt: number | string | null | undefined
): number {
  const sale = Number(salePrice);
  const cmp = compareAt != null && compareAt !== "" ? Number(compareAt) : NaN;
  if (!Number.isFinite(sale) || !Number.isFinite(cmp) || cmp <= sale) return 0;
  return Math.round(((cmp - sale) / cmp) * 100);
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Convert a UTC ISO string from the API to a local datetime-local input value (YYYY-MM-DDTHH:MM). */
export function toLocalDatetimeInput(utcString: string): string {
  if (!utcString) return "";
  const d = new Date(utcString);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

/** Convert a datetime-local input value (YYYY-MM-DDTHH:MM) to a UTC ISO string for the API. */
export function toUTCISO(localStr: string): string {
  if (!localStr) return "";
  return new Date(localStr).toISOString();
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function orderStatusLabel(status: string, orderType = "delivery"): string {
  if (status === "delivered" && orderType === "pickup") return "Picked Up";
  return status.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-blue-100 text-blue-800",
    processing: "bg-purple-100 text-purple-800",
    out_for_delivery: "bg-orange-100 text-orange-800",
    ready_for_pickup: "bg-teal-100 text-teal-800",
    delivered: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    refunded: "bg-gray-100 text-gray-800",
    partially_refunded: "bg-orange-100 text-orange-800",
    paid: "bg-green-100 text-green-800",
    unpaid: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
  };
  return colors[status] ?? "bg-gray-100 text-gray-800";
}
