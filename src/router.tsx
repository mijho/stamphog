import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { DefaultCatchBoundary } from "./components/default-catch-boundary";
import { NotFound } from "./components/not-found";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0, // Let React Query handle all caching
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
