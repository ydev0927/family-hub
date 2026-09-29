import { dashboardConfig } from './config';

export interface ScheduleItem {
  id: string;
  date: string;
  time: string | null;
  title: string;
  who: string;
  away?: boolean;
  past?: boolean;
  soon?: boolean;
  leaveAt?: string | null;
  departedAt?: string | null;
}

export interface TodoItem {
  id: string;
  title: string;
  who: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
}

export interface Score {
  who: string;
  score: number;
}

export interface HubState {
  now: { date: string; time: string };
  location: { name: string; latitude: number; longitude: number; timezone?: string };
  family: string[];
  schedule: ScheduleItem[];
  upcoming: ScheduleItem[];
  todos: TodoItem[];
  scoreboard: Score[];
}

export interface KitchenItem {
  id: string;
  name: string;
  daysLeft: number;
  likelihood: number;
}

export interface Kitchen {
  items: KitchenItem[];
  idea: { title: string; uses: string[]; usesNames: string[]; note: string } | null;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { url, token } = dashboardConfig.api;
  if (!url || !token) {
    throw new Error('Family Hub API is not configured (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_TOKEN)');
  }
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-access-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: an HTML error page or an empty body.
  }
  if (!res.ok) {
    throw new Error(json?.error ?? `${path} failed: HTTP ${res.status}`);
  }
  if (json === null) throw new Error(`${path} returned no JSON`);
  return json as T;
}

export const api = {
  state: () => request<HubState>('GET', '/state'),
  briefing: () => request<{ comment: string }>('GET', '/briefing'),
  kitchen: () => request<Kitchen>('GET', '/kitchen'),
  cooked: (uses: string[]) => request<Kitchen>('POST', '/kitchen/cooked', { uses }),
  qr: () => request<{ url: string; dataUrl: string }>('GET', '/qr'),
};
