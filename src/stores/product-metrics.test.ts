import { beforeEach, describe, expect, it } from 'vitest';
import { useProductMetricsStore } from './product-metrics';

describe('product metrics store', () => {
  beforeEach(() => {
    useProductMetricsStore.getState().clearAll();
  });

  it('tracks activation funnel events', () => {
    const store = useProductMetricsStore.getState();
    store.track('popup_opened', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });
    store.track('translate_started', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });
    store.track('translate_succeeded', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });

    const summary = useProductMetricsStore.getState().getSummary();
    expect(summary.popupOpened).toBe(1);
    expect(summary.translateStarted).toBe(1);
    expect(summary.translateSucceeded).toBe(1);
    expect(summary.activationRate).toBe(1);
    expect(summary.firstSuccessAt).not.toBeNull();
    expect(summary.recommendedProfile).toBe('provider-direct / siliconflow');
  });

  it('tracks demo success separately', () => {
    const store = useProductMetricsStore.getState();
    store.track('demo_started');
    store.track('demo_failed');
    store.track('demo_started');
    store.track('demo_succeeded');

    const summary = useProductMetricsStore.getState().getSummary();
    expect(summary.demoStarted).toBe(2);
    expect(summary.demoSucceeded).toBe(1);
    expect(summary.demoFailed).toBe(1);
    expect(summary.demoSuccessRate).toBe(0.5);
  });

  it('stores the first successful working profile', () => {
    const store = useProductMetricsStore.getState();
    store.track('translate_succeeded', {
      executionMode: 'server',
      provider: 'siliconflow',
    });
    store.track('translate_succeeded', {
      executionMode: 'provider-direct',
      provider: 'openai',
    });

    const summary = useProductMetricsStore.getState().getSummary();
    expect(summary.recommendedProfile).toBe('server / siliconflow');
  });

  it('builds an exportable report', () => {
    const store = useProductMetricsStore.getState();
    store.track('popup_opened', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });
    store.track('translate_started', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });
    store.track('translate_succeeded', {
      executionMode: 'provider-direct',
      provider: 'siliconflow',
    });

    const report = useProductMetricsStore.getState().getReport();
    expect(report.summary.translateSucceeded).toBe(1);
    expect(report.recentEvents).toHaveLength(3);
    expect(report.dailyFunnel[0]?.translateSucceeded).toBe(1);
  });
});
