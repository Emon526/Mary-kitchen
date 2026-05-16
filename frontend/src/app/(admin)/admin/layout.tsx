"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminOrderNotifications from "@/components/admin/AdminOrderNotifications";
import { useAuthStore } from "@/store/authStore";
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  Tag, Truck, ImageIcon, LogOut, ShoppingBag, Settings
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Products", href: "/admin/products", icon: Package },
  { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Categories", href: "/admin/categories", icon: Tag },
  { label: "Delivery Zones", href: "/admin/delivery", icon: Truck },
  { label: "Banners", href: "/admin/banners", icon: ImageIcon },
  { label: "Store Settings", href: "/admin/settings", icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated, logout } = useAuthStore();

  useEffect(() => {
    // Wait until Zustand has finished reading from localStorage
    if (!hasHydrated) return;

    if (!isAuthenticated) {
      router.push("/login");
    } else if (user && !user.is_staff) {
      router.push("/");
    }
  }, [hasHydrated, isAuthenticated, user?.is_staff]);

  // Show a full-screen spinner while rehydrating — prevents premature redirect
  if (!hasHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-900 text-gray-100 flex flex-col flex-shrink-0">
        <div className="p-5 border-b border-gray-800">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-white">
            <ShoppingBag className="w-6 h-6 text-brand-400" /> Mary Kitchen
          </Link>
          <p className="text-xs text-gray-400 mt-0.5">Admin Panel</p>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-medium text-white">{user?.full_name}</p>
            <p className="text-xs text-gray-400">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
          <h1 className="font-semibold text-gray-900">Admin Dashboard</h1>
          <div className="flex items-center gap-2">
            <AdminOrderNotifications />
            <Link href="/" className="text-sm text-primary-700 hover:underline whitespace-nowrap">← View Store</Link>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
