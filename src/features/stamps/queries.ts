import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import type {
  LeaderboardResponse,
  RecentActivity,
} from "../../../server/queries";

const DEFAULT_LEADERBOARD_WINDOW_DAYS = 30;
const POLL_INTERVAL_MS = 3000;

async function readQueryOnServer(path: string) {
  const { getLeaderboard, getRecentEvents } = await import(
    "../../../server/queries"
  );
  const { getDb } = await import("../../../server/db");
  const db = getDb();
  const url = new URL(path, "http://localhost");
  const windowDays = url.searchParams.has("windowDays")
    ? Number(url.searchParams.get("windowDays"))
    : undefined;
  const limit = url.searchParams.has("limit")
    ? Number(url.searchParams.get("limit"))
    : undefined;
  const args = { windowDays, limit };
  if (url.pathname === "/api/leaderboard") {
    return getLeaderboard(db, args);
  }
  if (url.pathname === "/api/events") {
    return getRecentEvents(db, args);
  }
  throw new Error(`Unknown server query path: ${path}`);
}

const serverReadQuery = createServerFn({ method: "GET" })
  .inputValidator((path: string) => path)
  .handler(async ({ data: path }) => readQueryOnServer(path));

async function fetchJson<T>(path: string) {
  if (import.meta.env.SSR) {
    return (await serverReadQuery({ data: path })) as T;
  }
  const url = new URL(path, window.location.origin);
  const response = await fetch(url);
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
