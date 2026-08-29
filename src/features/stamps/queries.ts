import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import type {
  LeaderboardResponse,
  RecentActivity,
} from "../../../server/queries";

const DEFAULT_LEADERBOARD_WINDOW_DAYS = 30;
const POLL_INTERVAL_MS = 3000;
const SERVER_API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

async function fetchJson<T>(path: string) {
  const url = import.meta.env.SSR
    ? new URL(path, SERVER_API_BASE)
    : new URL(path, window.location.origin);
  const headers: Record<string, string> = {};
  if (import.meta.env.SSR) {
    const identityHeader = process.env.READ_AUTH_IDENTITY_HEADER;
    const identityValue = process.env.READ_AUTH_ALLOWED_IDENTITIES;
    if (identityHeader && identityValue) {
      headers[identityHeader] = identityValue;
    }
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function leaderboardQuery(windowDays = DEFAULT_LEADERBOARD_WINDOW_DAYS) {
  return {
    queryKey: ["leaderboard", windowDays],
    queryFn: () =>
      fetchJson<LeaderboardResponse>(
        `/api/leaderboard?windowDays=${windowDays}`
      ),
    refetchInterval: POLL_INTERVAL_MS,
  };
}

export const recentStampEventsQuery = {
  queryKey: ["recent-events"],
  queryFn: () => fetchJson<RecentActivity[]>("/api/events"),
  refetchInterval: POLL_INTERVAL_MS,
};

export function useLeaderboard(windowDays = DEFAULT_LEADERBOARD_WINDOW_DAYS) {
  return useQuery({
    ...leaderboardQuery(windowDays),
    placeholderData: keepPreviousData,
  });
}

export function useRecentStampEvents() {
  return useSuspenseQuery(recentStampEventsQuery);
}
