/**
 * Zustand auth store – manages user session and tokens.
 *
 * Hydration note: the `persist` middleware is async. `hasHydrated` starts
 * false and flips to true once localStorage has been read. Protected routes
 * must wait for `hasHydrated` before acting on `isAuthenticated`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import Cookies from "js-cookie";
import api from "@/lib/api";

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone_number: string;
  avatar: string | null;
  is_email_verified: boolean;
  is_staff: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  setUser: (user: User) => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      hasHydrated: false,

      setHasHydrated: (v) => set({ hasHydrated: v }),

      login: async (email, password) => {
        set({ isLoading: true });
        const secure = process.env.NODE_ENV === "production";
        try {
          const { data } = await api.post("/auth/login/", { email, password });
          const { tokens, user } = data.data;
          Cookies.set("access_token", tokens.access, { expires: 1, secure, sameSite: "lax" });
          Cookies.set("refresh_token", tokens.refresh, { expires: 7, secure, sameSite: "lax" });
          set({ user, isAuthenticated: true, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          const refresh = Cookies.get("refresh_token");
          if (refresh) await api.post("/auth/logout/", { refresh });
        } catch {}
        Cookies.remove("access_token");
        Cookies.remove("refresh_token");
        set({ user: null, isAuthenticated: false });
      },

      fetchProfile: async () => {
        try {
          const { data } = await api.get("/users/profile/");
          set({ user: data, isAuthenticated: true });
        } catch (err: any) {
          // Only clear session on hard 401 — not on network errors or 5xx
          if (err?.response?.status === 401) {
            Cookies.remove("access_token");
            Cookies.remove("refresh_token");
            set({ user: null, isAuthenticated: false });
          }
        }
      },

      setUser: (user) => set({ user, isAuthenticated: true }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
      onRehydrateStorage: () => (state) => {
        // Called once rehydration from localStorage completes
        state?.setHasHydrated(true);
      },
    }
  )
);
