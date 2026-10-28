import { useEffect, useState } from "react";
import { useApi } from "../lib/api";

// Shared across components; signed URLs are valid for an hour.
const cache = new Map<string, string>();

/** Lets the composer show just-uploaded images without a round trip. */
export function primeImageUrl(path: string, url: string) {
  cache.set(path, url);
}

export function useSignedUrls(paths: string[]): Record<string, string> {
  const api = useApi();
  const key = paths.join("|");
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(paths.filter((p) => cache.has(p)).map((p) => [p, cache.get(p)!]))
  );

  useEffect(() => {
    const missing = paths.filter((p) => !cache.has(p));
    const known = () => Object.fromEntries(paths.filter((p) => cache.has(p)).map((p) => [p, cache.get(p)!]));
    if (missing.length === 0) {
      setUrls(known());
      return;
    }
    let alive = true;
    api.signedUrls(missing).then((res) => {
      for (const [p, u] of Object.entries(res)) cache.set(p, u);
      if (alive) setUrls(known());
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, api]);

  return urls;
}
