/**
 * Routing (/v1/route): which ComForce service a free-text request belongs
 * to, and whether it sounds urgent. Used to suggest triage on a new case.
 * Needs the API's OpenAI key; without it the call fails and staff pick by hand.
 */
import { useMutation } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { CaseCategory, RouteRequest, RouteResponse, Service } from '@/api/types';

export const routingApi = {
  route: (body: RouteRequest) => request<RouteResponse>('/route', { method: 'POST', body }),
};

/** The routing service's answer as a case category ("unclear" files under General support). */
export function categoryFor(service: Service): CaseCategory {
  return service === 'unclear' ? 'other' : service;
}

/** Asked on demand (a button), never in the background. */
export function useRouteRequest() {
  return useMutation({ mutationFn: (message: string) => routingApi.route({ message }) });
}
