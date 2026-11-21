/**
 * TanStack Query: the app's one cache of server data. Each domain's service
 * (services/<domain>.ts) builds its own query keys, so a mutation can
 * invalidate exactly what it changed.
 */
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ApiError } from '@/api/client';

const MAX_RETRIES = 2;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx won't change by asking again; network errors and 5xx might.
      retry: (failures, error) =>
        failures < MAX_RETRIES && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
    mutations: { retry: false },
  },
});

// React Native has no window focus; coming back to the app is the focus
// event, so stale data refetches when the app returns to the foreground.
AppState.addEventListener('change', (state) => {
  if (Platform.OS !== 'web') focusManager.setFocused(state === 'active');
});
