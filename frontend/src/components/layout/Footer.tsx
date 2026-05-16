"use client";

import Link from "next/link";
import { ShoppingBag, MapPin, Phone, Mail, Shield, Facebook, Instagram, Globe } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useStoreProfile } from "@/hooks/useStoreProfile";

const SHOP_LINKS = [
  { label: "All Products", href: "/products" },
  { label: "Fish & Seafood", href: "/products?category=fish-seafood" },
  { label: "Meat & Poultry", href: "/products?category=meat-poultry" },
  { label: "Vegetables", href: "/products?category=vegetables" },
  { label: "Rice & Grains", href: "/products?category=rice-grains" },
];

const ACCOUNT_LINKS_GUEST = [
  { label: "Login", href: "/login" },
  { label: "Register", href: "/register" },
];

const ACCOUNT_LINKS_AUTH = [
  { label: "My Orders", href: "/orders" },
  { label: "My Profile", href: "/profile" },
  { label: "Wishlist", href: "/profile#wishlist" },
];

const INFO_LINKS = [
  { label: "About Us", href: "/about" },
  { label: "Delivery Info", href: "/delivery" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Contact Us", href: "/contact" },
];

function safeHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[\s\-().]/g, "")}`;
}

export default function Footer() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const { data: store } = useStoreProfile();
  const accountLinks = hasHydrated && isAuthenticated ? ACCOUNT_LINKS_AUTH : ACCOUNT_LINKS_GUEST;

  const storeName = store?.name || "Mary Kitchen";
  const description = store?.description || "Your local Darwin grocery & food marketplace. Fresh products delivered to your door.";

  const addressParts = [
    store?.address,
    store?.suburb || store?.state
      ? [store.suburb, store.state, store.postcode].filter(Boolean).join(" ")
      : undefined,
  ].filter(Boolean);

  const facebookHref = store?.facebook ? safeHref(store.facebook) : undefined;
  const instagramHref = store?.instagram ? safeHref(store.instagram) : undefined;
  const websiteHref = store?.website ? safeHref(store.website) : undefined;
  const hasSocial = facebookHref || instagramHref || websiteHref;

  return (
    <footer className="bg-gray-900 text-gray-300 pt-14 pb-6 mt-auto">
      <div className="container-xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">

          {/* Column 1 — Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 text-white font-bold text-xl mb-3">
              <ShoppingBag className="w-6 h-6 text-primary-400" />
              {storeName}
            </Link>
            <p className="text-sm text-gray-400 leading-relaxed mb-4">{description}</p>

            <div className="space-y-2.5 text-sm">
              {addressParts.length > 0 && (
                <p className="flex items-start gap-2 text-gray-400">
                  <MapPin className="w-4 h-4 text-primary-400 mt-0.5 flex-shrink-0" />
                  <span className="whitespace-pre-line">{addressParts.join("\n")}</span>
                </p>
              )}
              {store?.phone && (
                <a href={telHref(store.phone)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
                  <Phone className="w-4 h-4 text-primary-400" />
                  {store.phone}
                </a>
              )}
              {store?.email && (
                <a href={`mailto:${store.email}`} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
                  <Mail className="w-4 h-4 text-primary-400" />
                  {store.email}
                </a>
              )}
            </div>

            {hasSocial && (
              <div className="flex items-center gap-3 mt-4">
                {facebookHref && (
                  <a href={facebookHref} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-gray-500 hover:text-white transition-colors">
                    <Facebook className="w-4 h-4" />
                  </a>
                )}
                {instagramHref && (
                  <a href={instagramHref} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-gray-500 hover:text-white transition-colors">
                    <Instagram className="w-4 h-4" />
                  </a>
                )}
                {websiteHref && (
                  <a href={websiteHref} target="_blank" rel="noopener noreferrer" aria-label="Website" className="text-gray-500 hover:text-white transition-colors">
                    <Globe className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Column 2 — Shop */}
          <div>
            <h3 className="font-semibold text-white mb-4">Shop</h3>
            <ul className="space-y-2.5 text-sm">
              {SHOP_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-gray-400 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3 — Account */}
          <div>
            <h3 className="font-semibold text-white mb-4">Account</h3>
            <ul className="space-y-2.5 text-sm">
              {accountLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-gray-400 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4 — Information */}
          <div>
            <h3 className="font-semibold text-white mb-4">Information</h3>
            <ul className="space-y-2.5 text-sm">
              {INFO_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-gray-400 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-gray-500">
          <p>© {new Date().getFullYear()} {storeName}. All rights reserved.</p>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-500" />
            <span>Secure payments by</span>
            <span className="font-bold text-white">Stripe</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
