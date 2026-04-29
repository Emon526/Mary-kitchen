/**
 * Turn a relative media path or API-relative URL into an absolute URL for <Image src />.
 * Prefer backend `image_url` when present; use this for legacy `image` paths.
 */
export function absoluteMediaUrl(urlOrPath: string | null | undefined): string | null {
  if (urlOrPath == null || urlOrPath === "") return null;
  const s = String(urlOrPath).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const origin = api.replace(/\/api\/v1\/?$/i, "");
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${origin}${path}`;
}
