import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface StoreProfile {
  id: string;
  name: string;
  tagline: string;
  email: string;
  phone: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  latitude: string | null;
  longitude: string | null;
  logo_url: string | null;
  description: string;
  opening_hours: string;
  website: string;
  facebook: string;
  instagram: string;
  updated_at: string;
}

export const STORE_PROFILE_PUBLIC_KEY = ["store-profile-public"] as const;

export function useStoreProfile() {
  return useQuery<StoreProfile>({
    queryKey: STORE_PROFILE_PUBLIC_KEY,
    queryFn: () => api.get("/store/profile/").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
