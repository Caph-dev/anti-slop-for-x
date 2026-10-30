import { DEFAULT_SETTINGS, type Settings } from '../../lib/types';
import { loadSettings, saveSettings } from '../../lib/settings';

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
    protocol: 'Protocol',
    workerBaseUrl: 'Worker base URL (proxy)',
    upstreamBaseUrl: 'Upstream base URL',
    upstreamPath: 'Decisions path (optional)',
    model: 'Model',
    apiKey: 'API key (stored in extension only)',
    defaultPrompt: 'Default prompt',
    keyHint:
      'The API key stays in chrome.storage.local. The Worker is a CORS-safe proxy and forwards your Authorization header. Do not put the real key in the Worker repo.',
    sectionWhitelist: 'Account whitelist',
    whitelistHelp: 'Handles (one per line, without @)',
    save: 'Save',
    testProxy: 'Test proxy',
    saved: 'Saved',
    testOk: 'Proxy OK',
    testFail: 'Proxy failed',
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
    protocol: '协议类型',
    workerBaseUrl: 'Worker 代理地址',
    upstreamBaseUrl: '上游 Base URL',
    upstreamPath: '决策路径（可选）',
    model: '模型名',
    apiKey: 'API Key（仅存扩展本地）',
    defaultPrompt: '默认提示词',
    keyHint:
      'API Key 只保存在 chrome.storage.local。Worker 是 CORS 安全代理，转发你的 Authorization 头。不要把真实 Jev Key 写进 Worker 仓库。',
    sectionWhitelist: '账号白名单',
    whitelistHelp: '用户名（每行一个，不要 @）',
    save: '保存',
    testProxy: '测试代理',
    saved: '已保存',
    testOk: '代理正常',
    testFail: '代理失败',
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
  'protocol',
  'workerBaseUrl',
  'upstreamBaseUrl',
  'upstreamPath',
  'model',
  'apiKey',
  'defaultPrompt',
];

function $(id: string) {
  return document.getElementById(id)!;
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
    workerBaseUrl: ($('workerBaseUrl') as HTMLInputElement).value.trim(),
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
  ($('workerBaseUrl') as HTMLInputElement).value = s.workerBaseUrl;
  ($('upstreamBaseUrl') as HTMLInputElement).value = s.upstreamBaseUrl;
  ($('upstreamPath') as HTMLInputElement).value = s.upstreamPath;
  ($('model') as HTMLInputElement).value = s.model;
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

  $('save').addEventListener('click', async () => {
    await saveSettings(readForm());
    setStatus(STR[lang()].saved);
  });

  $('test').addEventListener('click', async () => {
    const s = { ...DEFAULT_SETTINGS, ...(await loadSettings()), ...readForm() };
    try {
      const res = await fetch(`${s.workerBaseUrl.replace(/\/$/, '')}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setStatus(`${STR[lang()].testOk}: ${JSON.stringify(body)}`);
    } catch (e) {
      setStatus(`${STR[lang()].testFail}: ${(e as Error).message}`);
    }
  });

  void fields;
}

void main();
