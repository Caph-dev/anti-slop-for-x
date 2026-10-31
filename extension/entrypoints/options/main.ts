import { DEFAULT_SETTINGS, type EndpointPreset, type PostExtract, type Settings } from '../../lib/types';
import { loadSettings, saveSettings } from '../../lib/settings';
import { ENDPOINT_PRESETS, isPresetName } from '../../lib/endpoints';
import { decideUpstream } from '../../lib/upstream-client';
import { scoreFromUpstream } from '../../lib/adapters';
import { originPattern, requestOriginAccess } from '../../lib/permissions';

/** Fake post used by the Test button: one real model call with the user's key. */
const SAMPLE_POST: PostExtract = {
  id: 'options-test',
  handle: 'sample',
  text: 'Great point! This is a game-changer',
  isReply: true,
};

const STR: Record<string, Record<string, string>> = {
  en: {
    optionsTitle: 'Anti Slop for X',
    optionsSubtitle: 'Fold AI-slop / bot replies on X',
    sectionBehavior: 'Behavior',
    enabled: 'Enable',
    autoScan: 'Auto-scan',
    prefilterOnly: 'Prefilter only (skip model)',
    skipShortText: 'Skip short text',
    skipOwnPosts: 'Skip own posts',
    scanScope: 'Scan scope',
    scopeReplies: 'Replies only',
    scopeAll: 'Timeline + replies',
    threshold: 'Fold threshold',
    sectionModel: 'Decision model',
    endpointPreset: 'Endpoint',
    presetJev: 'TypeSafe / Jev (official)',
    presetOpenAI: 'OpenAI Decisions (official, contract unverified)',
    presetCustom: 'Custom endpoint',
    presetOpenAINote:
      'Points at https://api.openai.com/v1/decisions. That route accepts a Bearer API key, but its request/response contract has not been verified end to end — test it before relying on it, and pick Custom if your account expects a different shape.',
    protocol: 'Protocol',
    upstreamBaseUrl: 'Upstream base URL',
    upstreamPath: 'Decisions path (optional)',
    model: 'Model',
    apiKey: 'Your own API key (stored in this browser only)',
    defaultPrompt: 'Default prompt',
    keyHint:
      'No proxy: you paste your own key and it is sent only to the base URL above. Saving asks Chrome for host access to that origin. Keep the key out of screenshots and shared config files.',
    sectionWhitelist: 'Account whitelist',
    whitelistHelp: 'Handles (one per line, without @)',
    save: 'Save',
    testProxy: 'Test connection',
    saved: 'Saved',
    testOk: 'Model replied',
    testFail: 'Request failed',
    testNoPerm: 'Chrome host access was denied for that origin',
    testNoKey: 'Paste your API key first',
    badUrl: 'Invalid upstream base URL',
  },
  zh: {
    optionsTitle: 'Anti Slop for X',
    optionsSubtitle: '折叠 X 上的 AI 注水 / 机器人回复',
    sectionBehavior: '行为',
    enabled: '启用',
    autoScan: '自动扫描',
    prefilterOnly: '仅预筛（不调模型）',
    skipShortText: '跳过过短文本',
    skipOwnPosts: '跳过自己的帖子',
    scanScope: '扫描范围',
    scopeReplies: '仅回复',
    scopeAll: '时间线 + 回复',
    threshold: '折叠阈值',
    sectionModel: '决策模型',
    endpointPreset: '端点',
    presetJev: 'TypeSafe / Jev（官方）',
    presetOpenAI: 'OpenAI Decisions（官方，契约未验证）',
    presetCustom: '自定义端点',
    presetOpenAINote:
      '指向 https://api.openai.com/v1/decisions。该路由接受 Bearer API Key，但请求/响应契约尚未端到端验证：先用「测试连接」确认，若你的账号要求别的形状请改用自定义端点。',
    protocol: '协议类型',
    upstreamBaseUrl: '上游 Base URL',
    upstreamPath: '决策路径（可选）',
    model: '模型名',
    apiKey: '你自己的 API Key（仅存本浏览器）',
    defaultPrompt: '默认提示词',
    keyHint:
      '没有代理层：你填自己的 key，它只会发往上面的 Base URL。保存时 Chrome 会请求该 origin 的访问权限。不要把 key 截图或写进共享配置文件。',
    sectionWhitelist: '账号白名单',
    whitelistHelp: '用户名（每行一个，不要 @）',
    save: '保存',
    testProxy: '测试连接',
    saved: '已保存',
    testOk: '模型已响应',
    testFail: '请求失败',
    testNoPerm: 'Chrome 未授予该 origin 的访问权限',
    testNoKey: '请先填写 API Key',
    badUrl: '上游 Base URL 无效',
  },
};

function lang(): 'en' | 'zh' {
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function applyI18n() {
  const table = STR[lang()];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && table[key]) el.textContent = table[key];
  });
  // threshold label keeps dynamic value span — rebuild carefully
  const thrLabel = document.querySelector('label.field span[data-i18n="threshold"]');
  if (thrLabel) {
    thrLabel.innerHTML = `${table.threshold} (<span id="thresholdVal">0.55</span>)`;
  }
}

const fields: Array<keyof Settings> = [
  'enabled',
  'autoScan',
  'prefilterOnly',
  'skipShortText',
  'skipOwnPosts',
  'scanScope',
  'threshold',
  'endpointPreset',
  'protocol',
  'upstreamBaseUrl',
  'upstreamPath',
  'model',
  'apiKey',
  'defaultPrompt',
];

function $(id: string) {
  return document.getElementById(id)!;
}

const PRESET_FIELD_IDS = ['protocol', 'upstreamBaseUrl', 'upstreamPath'] as const;

/**
 * Fill and lock the endpoint fields for a built-in preset; `custom` unlocks
 * them and keeps whatever the user typed (or the last preset's values).
 * The model stays editable in every mode: it is a call parameter, not part of
 * the endpoint's identity.
 */
function applyPreset(preset: EndpointPreset, from?: Settings) {
  if (isPresetName(preset)) {
    const p = ENDPOINT_PRESETS[preset];
    ($('protocol') as HTMLSelectElement).value = p.protocol;
    ($('upstreamBaseUrl') as HTMLInputElement).value = p.baseUrl;
    ($('upstreamPath') as HTMLInputElement).value = p.path;
    ($('model') as HTMLInputElement).value = from?.model || p.model;
  } else if (from) {
    ($('protocol') as HTMLSelectElement).value = from.protocol;
    ($('upstreamBaseUrl') as HTMLInputElement).value = from.upstreamBaseUrl;
    ($('upstreamPath') as HTMLInputElement).value = from.upstreamPath;
    ($('model') as HTMLInputElement).value = from.model;
  }

  const locked = preset !== 'custom';
  for (const id of PRESET_FIELD_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.disabled = locked;
  }

  const note = document.getElementById('presetNote');
  if (note) note.hidden = preset !== 'openai-official';
}

function readForm(): Partial<Settings> {
  return {
    enabled: ($('enabled') as HTMLInputElement).checked,
    autoScan: ($('autoScan') as HTMLInputElement).checked,
    prefilterOnly: ($('prefilterOnly') as HTMLInputElement).checked,
    skipShortText: ($('skipShortText') as HTMLInputElement).checked,
    skipOwnPosts: ($('skipOwnPosts') as HTMLInputElement).checked,
    scanScope: ($('scanScope') as HTMLSelectElement).value as Settings['scanScope'],
    threshold: Number(($('threshold') as HTMLInputElement).value),
    protocol: ($('protocol') as HTMLSelectElement).value as Settings['protocol'],
    endpointPreset: ($('endpointPreset') as HTMLSelectElement).value as EndpointPreset,
    upstreamBaseUrl: ($('upstreamBaseUrl') as HTMLInputElement).value.trim(),
    upstreamPath: ($('upstreamPath') as HTMLInputElement).value.trim(),
    model: ($('model') as HTMLInputElement).value.trim(),
    apiKey: ($('apiKey') as HTMLInputElement).value,
    defaultPrompt: ($('defaultPrompt') as HTMLTextAreaElement).value,
    accountWhitelist: ($('accountWhitelist') as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean),
  };
}

function fillForm(s: Settings) {
  ($('enabled') as HTMLInputElement).checked = s.enabled;
  ($('autoScan') as HTMLInputElement).checked = s.autoScan;
  ($('prefilterOnly') as HTMLInputElement).checked = s.prefilterOnly;
  ($('skipShortText') as HTMLInputElement).checked = s.skipShortText;
  ($('skipOwnPosts') as HTMLInputElement).checked = s.skipOwnPosts;
  ($('scanScope') as HTMLSelectElement).value = s.scanScope;
  ($('threshold') as HTMLInputElement).value = String(s.threshold);
  const tv = document.getElementById('thresholdVal');
  if (tv) tv.textContent = s.threshold.toFixed(2);
  ($('protocol') as HTMLSelectElement).value = s.protocol;
  ($('endpointPreset') as HTMLSelectElement).value = s.endpointPreset;
  applyPreset(s.endpointPreset, s);
  ($('apiKey') as HTMLInputElement).value = s.apiKey;
  ($('defaultPrompt') as HTMLTextAreaElement).value = s.defaultPrompt;
  ($('accountWhitelist') as HTMLTextAreaElement).value = s.accountWhitelist.join('\n');
}

function setStatus(msg: string) {
  $('status').textContent = msg;
}

async function main() {
  applyI18n();
  const settings = await loadSettings();
  fillForm(settings);

  $('threshold').addEventListener('input', () => {
    const v = Number(($('threshold') as HTMLInputElement).value);
    const tv = document.getElementById('thresholdVal');
    if (tv) tv.textContent = v.toFixed(2);
  });

  $('endpointPreset').addEventListener('change', () => {
    // No `from`: switching to custom keeps the values already on screen.
    applyPreset(($('endpointPreset') as HTMLSelectElement).value as EndpointPreset);
  });

  $('save').addEventListener('click', () => {
    const form = readForm();
    const baseUrl = form.upstreamBaseUrl || '';
    if (originPattern(baseUrl) === null) {
      setStatus(`${STR[lang()].badUrl}: ${baseUrl}`);
      return;
    }
    // Must start inside the click gesture: Chrome rejects a late permission request.
    // Attach the rejection handler immediately so a denial never becomes unhandled.
    const granted = requestOriginAccess(baseUrl).catch(() => false);
    void (async () => {
      try {
        await saveSettings(form);
      } catch (e) {
        setStatus(`${STR[lang()].testFail}: ${(e as Error).message}`);
        return;
      }
      const ok = await granted;
      setStatus(ok ? STR[lang()].saved : `${STR[lang()].saved} — ${STR[lang()].testNoPerm}`);
    })();
  });

  $('test').addEventListener('click', () => {
    const form = readForm();
    const baseUrl = form.upstreamBaseUrl || '';
    if (originPattern(baseUrl) === null) {
      setStatus(`${STR[lang()].badUrl}: ${baseUrl}`);
      return;
    }
    // Same gesture rule as Save; resolves true without prompting when already granted.
    const granted = requestOriginAccess(baseUrl).catch(() => false);
    void (async () => {
      try {
        const ok = await granted;
        const s = { ...DEFAULT_SETTINGS, ...(await loadSettings()), ...form };
        if (!(s.apiKey || '').trim()) {
          setStatus(STR[lang()].testNoKey);
          return;
        }
        if (!ok) {
          setStatus(STR[lang()].testNoPerm);
          return;
        }
        setStatus('…');
        const raw = await decideUpstream(SAMPLE_POST, s);
        const { score, reason } = scoreFromUpstream(s.protocol, raw);
        setStatus(`${STR[lang()].testOk}: score ${score.toFixed(2)} — ${reason}`);
      } catch (e) {
        setStatus(`${STR[lang()].testFail}: ${(e as Error).message}`);
      }
    })();
  });

  void fields;
}

void main();
