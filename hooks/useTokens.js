// hooks/useTokens.js — SWR-based polling hook for live data
import useSWR from "swr";

const fetcher = (url) => fetch(url).then((r) => r.json());

export function useTokens(refreshInterval = 10000) {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/tokens",
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    tokens: data?.tokens ?? [],
    updatedAt: data?.updatedAt,
    isLoading,
    isError: !!error,
    refresh: mutate,
  };
}

export function useTokenDetail(mint) {
  const { data, error, isLoading } = useSWR(
    mint ? `/api/token/${mint}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  return { detail: data, isLoading, isError: !!error };
}
