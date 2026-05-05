"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/utils";
import { ShoppingCart, DollarSign, TrendingUp, AlertTriangle, ReceiptText, Percent } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type AdminStats = {
  revenue_7d: number;
  orders_count: number;
  aov: number;
  growth: number;
  status_breakdown: { payment_status: string; count: number }[];
};

type RevenuePoint = {
  name: string;
  revenue: number;
};

type TopProduct = {
  product_id: number;
  name: string;
  total_quantity: number;
  total_revenue: number;
};

type ConversionStats = {
  visits: number;
  orders: number;
  conversion_rate: number;
};

type LowStockProduct = {
  id: string;
  name: string;
  slug: string;
  category_name: string;
  stock_quantity: number;
  unit: string;
  is_out_of_stock: boolean;
};

export default function AdminDashboardPage() {
  const { data: orders } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => api.get("/orders/admin/orders/?page_size=5").then((r) => r.data),
  });

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => api.get("/orders/admin/stats/").then((r) => r.data),
  });

  const { data: revenueData } = useQuery<RevenuePoint[]>({
    queryKey: ["admin-revenue"],
    queryFn: () => api.get("/orders/admin/revenue/?days=7").then((r) => r.data),
  });

  const { data: topProducts } = useQuery<TopProduct[]>({
    queryKey: ["top-products"],
    queryFn: () => api.get("/orders/admin/top-products/?days=7").then((r) => r.data),
  });

  const { data: conversion } = useQuery<ConversionStats>({
    queryKey: ["conversion-rate"],
    queryFn: () => api.get("/analytics/conversion/?days=7").then((r) => r.data),
  });

  const { data: lowStockProducts } = useQuery<LowStockProduct[]>({
    queryKey: ["admin-low-stock-products"],
    queryFn: () => api.get("/products/admin/low-stock/?threshold=0&limit=8").then((r) => r.data),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const recentOrders = orders?.results || [];
  const formatGrowth = (value?: number) => {
    if (value === undefined) return "—";
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(1)}%`;
  };

  const STATS = [
    { label: "Revenue (7d)", value: stats ? formatCurrency(stats.revenue_7d) : "—", sub: "Paid orders, last 7 days", icon: DollarSign, color: "bg-brand-500" },
    { label: "Orders", value: stats ? stats.orders_count : "—", sub: "All orders, last 7 days", icon: ShoppingCart, color: "bg-blue-500" },
    { label: "AOV", value: stats ? formatCurrency(stats.aov) : "—", sub: "Revenue divided by orders", icon: ReceiptText, color: "bg-purple-500" },
    { label: "Growth", value: formatGrowth(stats?.growth), sub: "Vs previous 7 days", icon: TrendingUp, color: "bg-green-500" },
    { label: "Conversion", value: conversion ? `${conversion.conversion_rate.toFixed(1)}%` : "—", sub: "Paid orders / visits, last 7 days", icon: Percent, color: "bg-orange-500" },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Overview</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {STATS.map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center text-white`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm text-gray-500 mt-0.5">{label}</p>
            {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Recent Orders + Chart */}
      <div className="grid lg:grid-cols-5 gap-6 mb-6">
        {/* Chart */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Revenue Overview – Last 7 Days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueData ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => [`$${v}`, "Revenue"]} />
              <Bar dataKey="revenue" fill="#1a6b3c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Product stock alert */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" /> Out-of-Stock Products
          </h3>
          {!lowStockProducts ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading stock alerts...</p>
          ) : lowStockProducts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No out-of-stock products</p>
          ) : (
            <div className="space-y-2">
              {lowStockProducts.map((product) => (
                <a
                  key={product.id}
                  href={`/admin/products/${product.id}/edit`}
                  className="block p-3 bg-orange-50 rounded-lg text-sm hover:bg-orange-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{product.name}</p>
                      <p className="text-gray-500">{product.category_name}</p>
                    </div>
                    <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-1 rounded-full whitespace-nowrap">
                      {product.stock_quantity} {product.unit}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
        <div className="p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Top Products</h3>
          <p className="text-sm text-gray-500 mt-0.5">Paid orders, last 7 days</p>
        </div>
        <div className="overflow-x-auto">
          {!topProducts ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading top products...</p>
          ) : topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No paid product sales in the last 7 days</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Product", "Quantity Sold", "Revenue"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topProducts.map((product) => (
                  <tr key={product.product_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">{product.name}</td>
                    <td className="px-5 py-3 text-gray-700">{product.total_quantity}</td>
                    <td className="px-5 py-3 font-semibold">{formatCurrency(product.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-semibold text-gray-900">Recent Orders</h3>
          <a href="/admin/orders" className="text-sm text-primary-700 hover:underline">View all</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Order", "Customer", "Status", "Total", "Date"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentOrders.map((order: any) => (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-mono font-medium text-primary-700">#{order.order_number}</td>
                  <td className="px-5 py-3 text-gray-700">{order.user_email}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${getStatusColor(order.status)}`}>{order.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-5 py-3 font-semibold">{formatCurrency(order.total_amount)}</td>
                  <td className="px-5 py-3 text-gray-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
