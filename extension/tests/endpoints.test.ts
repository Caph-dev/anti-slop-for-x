import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_PRESETS,
  deriveEndpointPreset,
  isPresetName,
  resolveEndpoint,
} from '../lib/endpoints';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('resolveEndpoint', () => {
  it('ignores the stored base URL and path while a preset is selected', () => {
    const s = settings({
      endpointPreset: 'openai-official',
      upstreamBaseUrl: 'https://stale.example.com/v1',
      upstreamPath: '/stale',
      protocol: 'jev',
      model: 'stale-model',
    });

    expect(resolveEndpoint(s)).toEqual({
      ...ENDPOINT_PRESETS['openai-official'],
      model: 'stale-model',
    });
  });

  it('falls back to the preset model when the model field is empty', () => {
    const s = settings({ endpointPreset: 'jev-official', model: '   ' });
    expect(resolveEndpoint(s).model).toBe(ENDPOINT_PRESETS['jev-official'].model);
  });

  it('uses the stored fields for a custom endpoint', () => {
    const s = settings({
      endpointPreset: 'custom',
      upstreamBaseUrl: 'https://gateway.example.com/v1',
      upstreamPath: '/decide',
      protocol: 'openai-decisions',
      model: 'my-model',
    });

    expect(resolveEndpoint(s)).toEqual({
      baseUrl: 'https://gateway.example.com/v1',
      path: '/decide',
      protocol: 'openai-decisions',
      model: 'my-model',
    });
  });

  it('ships exactly the two official presets plus custom', () => {
    expect(Object.keys(ENDPOINT_PRESETS).sort()).toEqual(['jev-official', 'openai-official']);
    expect(ENDPOINT_PRESETS['jev-official'].protocol).toBe('jev');
    expect(ENDPOINT_PRESETS['openai-official'].protocol).toBe('openai-decisions');
    expect(ENDPOINT_PRESETS['openai-official'].baseUrl).toBe('https://api.openai.com/v1');
    expect(ENDPOINT_PRESETS['openai-official'].path).toBe('/decisions');
  });
});

describe('deriveEndpointPreset', () => {
  it('maps legacy default settings to the Jev preset', () => {
    expect(
      deriveEndpointPreset({
        upstreamBaseUrl: 'https://api.typesafe.ai/v1',
        upstreamPath: '/systemone',
        protocol: 'jev',
      }),
    ).toBe('jev-official');
  });

  it('maps an OpenAI base URL to the OpenAI preset', () => {
    expect(
      deriveEndpointPreset({
        upstreamBaseUrl: 'https://api.openai.com/v1',
        upstreamPath: '/decisions',
        protocol: 'openai-decisions',
      }),
    ).toBe('openai-official');
  });

  it('treats an unknown base URL as custom so upgrades never repoint it', () => {
    expect(
      deriveEndpointPreset({
        upstreamBaseUrl: 'https://gateway.example.com/v1',
        upstreamPath: '/decide',
        protocol: 'jev',
      }),
    ).toBe('custom');
  });

  it('treats an official base URL with a custom path or protocol as custom', () => {
    expect(
      deriveEndpointPreset({
        upstreamBaseUrl: 'https://api.typesafe.ai/v1',
        upstreamPath: '/v2/other',
        protocol: 'jev',
      }),
    ).toBe('custom');
    expect(
      deriveEndpointPreset({
        upstreamBaseUrl: 'https://api.typesafe.ai/v1',
        upstreamPath: '/systemone',
        protocol: 'openai-decisions',
      }),
    ).toBe('custom');
  });

  it('falls back to the Jev preset for empty settings', () => {
    expect(deriveEndpointPreset({})).toBe('jev-official');
    expect(deriveEndpointPreset({ upstreamBaseUrl: '' })).toBe('jev-official');
  });

  it('keeps an explicit preset choice', () => {
    expect(deriveEndpointPreset({ endpointPreset: 'custom' })).toBe('custom');
    expect(deriveEndpointPreset({ endpointPreset: 'openai-official' })).toBe('openai-official');
  });

  it('rejects unknown preset strings', () => {
    expect(isPresetName('nope')).toBe(false);
    expect(isPresetName('custom')).toBe(false);
    expect(isPresetName('openai-official')).toBe(true);
    expect(
      deriveEndpointPreset({ endpointPreset: 'nope' as never, upstreamBaseUrl: '' }),
    ).toBe('jev-official');
  });
});
