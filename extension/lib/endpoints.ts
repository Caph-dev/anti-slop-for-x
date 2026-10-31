/**
 * Built-in upstream endpoints plus the user's own (custom) one.
 *
 * A preset fully determines base URL, decisions path, payload protocol and
 * model, so picking one cannot leave the settings in a half-configured state.
 * `custom` uses whatever the user typed.
 */
import type { EndpointPreset, ProtocolType, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

export interface EndpointConfig {
  baseUrl: string;
  path: string;
  protocol: ProtocolType;
  model: string;
}

export type PresetName = Exclude<EndpointPreset, 'custom'>;

export const ENDPOINT_PRESETS: Record<PresetName, EndpointConfig> = {
  'jev-official': {
    baseUrl: 'https://api.typesafe.ai/v1',
    path: '/systemone',
    protocol: 'jev',
    model: 'jev-latest',
  },
  'openai-official': {
    baseUrl: 'https://api.openai.com/v1',
    path: '/decisions',
    protocol: 'openai-decisions',
    model: 'gpt-6-luna',
  },
};

const PRESET_NAMES = Object.keys(ENDPOINT_PRESETS) as PresetName[];

export function isPresetName(value: unknown): value is PresetName {
  return typeof value === 'string' && (PRESET_NAMES as string[]).includes(value);
}

export type EndpointSettings = Pick<
  Settings,
  'endpointPreset' | 'upstreamBaseUrl' | 'upstreamPath' | 'protocol' | 'model'
>;

/** Effective endpoint for a settings object. Presets own base URL, path and
 * protocol; `model` stays a user knob (the preset only supplies its default). */
export function resolveEndpoint(settings: EndpointSettings): EndpointConfig {
  const preset = settings.endpointPreset;
  if (isPresetName(preset)) {
    const builtin = ENDPOINT_PRESETS[preset];
    return { ...builtin, model: (settings.model || '').trim() || builtin.model };
  }
  return {
    baseUrl: settings.upstreamBaseUrl,
    path: settings.upstreamPath,
    protocol: settings.protocol,
    model: settings.model,
  };
}

function normalizeBase(url: string | undefined): string {
  return (url || '').trim().replace(/\/+$/, '');
}

function matchesPreset(settings: Partial<Settings>, name: PresetName): boolean {
  const preset = ENDPOINT_PRESETS[name];
  if (normalizeBase(settings.upstreamBaseUrl) !== preset.baseUrl) return false;
  if ((settings.protocol ?? preset.protocol) !== preset.protocol) return false;
  // Compare the path that would actually have been used: a missing path falls
  // back to DEFAULT_SETTINGS.upstreamPath (/systemone), exactly as the pre-preset
  // resolver did. An OpenAI base URL with no stored path therefore stays
  // `custom`, because it used to resolve to /systemone, not /decisions.
  const path = (settings.upstreamPath ?? DEFAULT_SETTINGS.upstreamPath).trim();
  return path === '' || path === preset.path;
}

/**
 * Infer the preset for settings saved before `endpointPreset` existed.
 * Anything that does not exactly match a built-in endpoint becomes `custom`,
 * so a hand-edited base URL is never silently overwritten.
 *
 * A missing path is compared as the value that would actually have been used:
 * `DEFAULT_SETTINGS.upstreamPath` (`/systemone`). So legacy Jev settings with no
 * path still land on `jev-official`, while an OpenAI base URL with no path stays
 * `custom` — it used to post to `/systemone`, and no upgrade should silently
 * repoint it to `/decisions`.
 */
export function deriveEndpointPreset(settings: Partial<Settings> = {}): EndpointPreset {
  if (settings.endpointPreset === 'custom' || isPresetName(settings.endpointPreset)) {
    return settings.endpointPreset;
  }
  for (const name of PRESET_NAMES) {
    if (matchesPreset(settings, name)) return name;
  }
  return normalizeBase(settings.upstreamBaseUrl) ? 'custom' : 'jev-official';
}
