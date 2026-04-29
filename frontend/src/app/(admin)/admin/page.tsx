"use client";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/utils";
import { ShoppingCart, Users, Package, DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

export default function AdminDashboardPage() {
  const { data: orders } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => api.get("/orders/admin/orders/?page_size=5").then((r) => r.data),
  });

  const { data: users } = useQuery({
    queryKey: ["admin-users-count"],
    queryFn: () => api.get("/users/admin/users/?page_size=1").then((r) => r.data),
  });

  const { data: products } = useQuery({
    queryKey: ["admin-products"],
    queryFn: () => api.get("/products/admin/products/?page_size=1").then((r) => r.data),
  });

  const totalOrders = orders?.count || 0;
  const totalUsers = users?.count || 0;
  const totalProducts = products?.count || 0;

  const recentOrders = orders?.results || [];
  const revenue = recentOrders.reduce((sum: number, o: any) => sum + Number(o.total_amount), 0);

  const STATS = [
    { label: "Total Orders", value: totalOrders, icon: ShoppingCart, color: "bg-blue-500", change: "+12%" },
    { label: "Total Users", value: totalUsers, icon: Users, color: "bg-green-500", change: "+8%" },
    { label: "Products", value: totalProducts, sub: "Total in catalog (all pages)", icon: Package, color: "bg-purple-500", change: "+3%" },
    { label: "Recent Revenue", value: formatCurrency(revenue), icon: DollarSign, color: "bg-brand-500", change: "+15%" },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Overview</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {STATS.map(({ label, value, sub, icon: Icon, color, change }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center text-white`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-xs text-green-600 font-semibold flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" /> {change}
              </span>
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
          <h3 className="font-semibold text-gray-900 mb-4">Revenue Overview</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={[
              { name: "Mon", revenue: 320 }, { name: "Tue", revenue: 480 },
              { name: "Wed", revenue: 290 }, { name: "Thu", revenue: 610 },
              { name: "Fri", revenue: 750 }, { name: "Sat", revenue: 900 },
              { name: "Sun", revenue: 420 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [`$${v}`, "Revenue"]} />
              <Bar dataKey="revenue" fill="#1a6b3c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* OOS Alert */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" /> Out-of-Stock Orders
          </h3>
          {recentOrders.filter((o: any) => o.has_out_of_stock_items).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No out-of-stock alerts</p>
          ) : (
            <div className="space-y-2">
              {recentOrders.filter((o: any) => o.has_out_of_stock_items).map((o: any) => (
                <div key={o.id} className="p-3 bg-orange-50 rounded-lg text-sm">
                  <p className="font-medium text-gray-900">#{o.order_number}</p>
                  <p className="text-gray-500">{o.user_email}</p>
                </div>
              ))}
            </div>
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
