import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProviderType } from '@/providers/base';

export interface RecommendedProfile {
  executionMode: 'server' | 'provider-direct';
  provider: ProviderType | 'unknown';
  timestamp: number;
}

const KNOWN_PROVIDERS: ProviderType[] = [
  'siliconflow',
  'dashscope',
  'openai',
  'claude',
  'deepseek',
  'ollama',
];

function toProviderType(value: unknown): ProviderType | 'unknown' {
  return typeof value === 'string' &&
    KNOWN_PROVIDERS.includes(value as ProviderType)
    ? (value as ProviderType)
    : 'unknown';
}

export type ProductEventType =
  | 'popup_opened'
  | 'settings_opened'
  | 'options_opened'
  | 'quickstart_selected'
  | 'translate_started'
  | 'translate_succeeded'
  | 'translate_failed'
  | 'demo_started'
  | 'demo_succeeded'
  | 'demo_failed';

export interface ProductEvent {
  type: ProductEventType;
  timestamp: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ProductMetricsState {
  events: ProductEvent[];
  firstSuccessAt: number | null;
  recommendedProfile: RecommendedProfile | null;
}

export interface ProductMetricsActions {
  track: (
    type: ProductEventType,
    metadata?: Record<string, string | number | boolean | null>
  ) => void;
  getSummary: () => {
    popupOpened: number;
    optionsOpened: number;
    quickstartSelected: number;
    translateStarted: number;
    translateSucceeded: number;
    translateFailed: number;
    demoStarted: number;
    demoSucceeded: number;
    demoFailed: number;
    firstSuccessAt: number | null;
    recommendedProfile: string | null;
    activationRate: number;
    demoSuccessRate: number;
  };
  getReport: () => {
    exportedAt: string;
    summary: ReturnType<ProductMetricsActions['getSummary']>;
    recentEvents: ProductEvent[];
    dailyFunnel: Array<{
      date: string;
      popupOpened: number;
      translateStarted: number;
      translateSucceeded: number;
      demoStarted: number;
      demoSucceeded: number;
    }>;
  };
  clearAll: () => void;
}

const MAX_EVENTS = 200;

const chromeLocalStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get([name]);
        return result[name] ? JSON.stringify(result[name]) : null;
      }
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [name]: parsed });
      } else {
        localStorage.setItem(name, value);
      }
    } catch {
      // no-op
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove([name]);
      } else {
        localStorage.removeItem(name);
      }
    } catch {
      // no-op
    }
  },
};

export const useProductMetricsStore = create<
  ProductMetricsState & ProductMetricsActions
>()(
  persist(
    (set, get) => ({
      events: [],
      firstSuccessAt: null,
      recommendedProfile: null,
      track: (type, metadata) => {
        const event: ProductEvent = {
          type,
          timestamp: Date.now(),
          metadata,
        };

        const isSuccess =
          type === 'translate_succeeded' || type === 'demo_succeeded';
        const profile =
          typeof metadata?.['executionMode'] === 'string'
            ? {
                executionMode: metadata['executionMode'] as
                  | 'server'
                  | 'provider-direct',
                provider: toProviderType(metadata['provider']),
                timestamp: event.timestamp,
              }
            : null;

        set(state => ({
          events: [event, ...state.events].slice(0, MAX_EVENTS),
          firstSuccessAt:
            state.firstSuccessAt ??
            (isSuccess ? event.timestamp : null),
          recommendedProfile:
            state.recommendedProfile ?? (isSuccess ? profile : null),
        }));
      },
      getSummary: () => {
        const { events, firstSuccessAt, recommendedProfile } = get();
        const count = (type: ProductEventType) =>
          events.filter(event => event.type === type).length;

        const popupOpened = count('popup_opened');
        const translateStarted = count('translate_started');
        const translateSucceeded = count('translate_succeeded');
        const demoStarted = count('demo_started');
        const demoSucceeded = count('demo_succeeded');

        return {
          popupOpened,
          optionsOpened: count('options_opened'),
          quickstartSelected: count('quickstart_selected'),
          translateStarted,
          translateSucceeded,
          translateFailed: count('translate_failed'),
          demoStarted,
          demoSucceeded,
          demoFailed: count('demo_failed'),
          firstSuccessAt,
          recommendedProfile: recommendedProfile
            ? `${recommendedProfile.executionMode} / ${recommendedProfile.provider}`
            : null,
          activationRate:
            popupOpened > 0 ? translateSucceeded / popupOpened : 0,
          demoSuccessRate: demoStarted > 0 ? demoSucceeded / demoStarted : 0,
        };
      },
      getReport: () => {
        const { events } = get();
        const summary = get().getSummary();
        const dailyMap = new Map<
          string,
          {
            date: string;
            popupOpened: number;
            translateStarted: number;
            translateSucceeded: number;
            demoStarted: number;
            demoSucceeded: number;
          }
        >();

        for (const event of events) {
          const date = new Date(event.timestamp).toISOString().slice(0, 10);
          const current = dailyMap.get(date) ?? {
            date,
            popupOpened: 0,
            translateStarted: 0,
            translateSucceeded: 0,
            demoStarted: 0,
            demoSucceeded: 0,
          };

          if (event.type === 'popup_opened') {
            current.popupOpened += 1;
          }
          if (event.type === 'translate_started') {
            current.translateStarted += 1;
          }
          if (event.type === 'translate_succeeded') {
            current.translateSucceeded += 1;
          }
          if (event.type === 'demo_started') {
            current.demoStarted += 1;
          }
          if (event.type === 'demo_succeeded') {
            current.demoSucceeded += 1;
          }

          dailyMap.set(date, current);
        }

        return {
          exportedAt: new Date().toISOString(),
          summary,
          recentEvents: events.slice(0, 50),
          dailyFunnel: Array.from(dailyMap.values()).sort((a, b) =>
            b.date.localeCompare(a.date)
          ),
        };
      },
      clearAll: () =>
        set({ events: [], firstSuccessAt: null, recommendedProfile: null }),
    }),
    {
      name: 'manga-translator-product-metrics-v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    }
  )
);
