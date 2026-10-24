import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, findMatchingPreset } from './provider-presets';
import { detectServiceName } from '@/utils/provider-label';

describe('provider presets', () => {
  it('gives every preset the fields the settings page needs', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.baseUrl).toMatch(/^https:\/\//);
      expect(preset.model).toBeTruthy();
      expect(preset.keyUrl).toMatch(/^https:\/\//);
      expect(preset.note).toBeTruthy();
    }
  });

  it('has no duplicate ids', () => {
    const ids = PROVIDER_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate endpoints', () => {
    const urls = PROVIDER_PRESETS.map(preset => preset.baseUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  /**
   * A preset whose label disagrees with the service the endpoint actually
   * points at would show the user one name in the picker and a different one
   * on their bill.
   */
  it('labels every preset with the service its endpoint really is', () => {
    for (const preset of PROVIDER_PRESETS) {
      const service = detectServiceName(preset.baseUrl);
      expect(service).not.toBeNull();
      expect(preset.label).toContain(service as string);
    }
  });

  it('ships the default endpoint as a preset', () => {
    // The extension's out-of-the-box backend has to be reachable by one
    // click, or "preloaded backend" and "preset" describe different things.
    const match = PROVIDER_PRESETS.find(preset => preset.id === 'minimax');
    expect(match).toBeDefined();
    expect(match?.baseUrl).toBe('https://api.minimaxi.com/v1');
  });
});

describe('findMatchingPreset', () => {
  it('matches a preset on endpoint and model together', () => {
    const preset = PROVIDER_PRESETS[0];
    expect(preset).toBeDefined();
    expect(
      findMatchingPreset({
        baseUrl: preset?.baseUrl ?? '',
        model: preset?.model ?? '',
      })
    ).toBe(preset);
  });

  it('ignores a trailing slash on the endpoint', () => {
    const preset = PROVIDER_PRESETS[0];
    expect(
      findMatchingPreset({
        baseUrl: `${preset?.baseUrl ?? ''}/`,
        model: preset?.model ?? '',
      })
    ).toBe(preset);
  });

  /**
   * The endpoint alone is not enough: the user may have picked a different
   * model on the same service, and highlighting the preset would misreport
   * what they are about to be billed for.
   */
  it('does not match when only the endpoint matches', () => {
    const preset = PROVIDER_PRESETS[0];
    expect(
      findMatchingPreset({
        baseUrl: preset?.baseUrl ?? '',
        model: 'some-other-model',
      })
    ).toBeNull();
  });

  it('does not match an empty configuration', () => {
    expect(findMatchingPreset({ baseUrl: '', model: '' })).toBeNull();
  });
});
