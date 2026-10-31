import { loadSettings } from '../../lib/settings';
import { ENDPOINT_PRESETS, isPresetName, resolveEndpoint } from '../../lib/endpoints';
import type { EndpointPreset, Settings } from '../../lib/types';

type Lang = 'en' | 'zh';

interface Strings {
  subtitle: string;
  lblEndpoint: string;
  lblModel: string;
  lblScope: string;
  lblStatus: string;
  scan: string;
  settings: string;
  scopeReplies: string;
  scopeAll: string;
  on: string;
  off: string;
  prefilterOnly: string;
  presetJev: string;
  presetOpenAI: string;
  presetCustom: string;
  notXTab: string;
  noContentScript: string;
  scanning: string;
  scanned: (n: number) => string;
  scannedZero: string;
  scanFailed: string;
}

const STR: Record<Lang, Strings> = {
  en: {
    subtitle: 'Fold AI-slop / bot replies on X',
    lblEndpoint: 'Endpoint',
    lblModel: 'Model',
    lblScope: 'Scope',
    lblStatus: 'Status',
    scan: 'Scan current page',
    settings: 'Options',
    scopeReplies: 'Replies only',
    scopeAll: 'Timeline + replies',
    on: 'Enabled',
    off: 'Disabled',
    prefilterOnly: 'Prefilter only',
    presetJev: 'TypeSafe / Jev',
    presetOpenAI: 'OpenAI Decisions',
    presetCustom: 'Custom',
    notXTab: 'This tab is not x.com — open a profile or a post first.',
    noContentScript:
      'No content script in this tab. Reload the tab once after installing or reloading the extension.',
    scanning: 'Scanning…',
    scanned: (n: number) => `Scanned ${n} post${n === 1 ? '' : 's'}.`,
    scannedZero:
      'Nothing to scan here. On the home timeline only replies are scored unless you switch Scope to "Timeline + replies".',
    scanFailed: 'Scan failed',
  },
  zh: {
    subtitle: '折叠 X 上的 AI 注水 / 机器人回复',
    lblEndpoint: '端点',
    lblModel: '模型',
    lblScope: '范围',
    lblStatus: '状态',
    scan: '扫描当前页',
    settings: '选项',
    scopeReplies: '仅回复',
    scopeAll: '时间线 + 回复',
    on: '已启用',
    off: '已停用',
    prefilterOnly: '仅预筛',
    presetJev: 'TypeSafe / Jev',
    presetOpenAI: 'OpenAI Decisions',
    presetCustom: '自定义',
    notXTab: '当前标签不是 x.com —— 先打开一个用户页或推文页。',
    noContentScript: '这个标签里没有 content script。安装或重载扩展后，请刷新一次该标签页。',
    scanning: '扫描中…',
    scanned: (n: number) => `已扫描 ${n} 条。`,
    scannedZero:
      '这里没有可扫描的内容。首页时间线在「仅回复」模式下只处理回复，想扫主帖请把范围改成「时间线 + 回复」。',
    scanFailed: '扫描失败',
  },
};

function lang(): Lang {
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function endpointLabel(settings: Settings, t: Strings): string {
  const preset: EndpointPreset = settings.endpointPreset;
  if (preset === 'jev-official') return t.presetJev;
  if (preset === 'openai-official') return t.presetOpenAI;
  // Custom endpoints show the host so two different ones stay distinguishable.
  try {
    return `${t.presetCustom} · ${new URL(settings.upstreamBaseUrl).host}`;
  } catch {
    return t.presetCustom;
  }
}

function note(message: string, warn = false) {
  const el = $('note');
  el.textContent = message;
  el.classList.toggle('warn', warn);
}

function applyLabels(t: Strings) {
  $('subtitle').textContent = t.subtitle;
  $('lblEndpoint').textContent = t.lblEndpoint;
  $('lblModel').textContent = t.lblModel;
  $('lblScope').textContent = t.lblScope;
  $('lblStatus').textContent = t.lblStatus;
  $('scan').textContent = t.scan;
  $('settings').textContent = t.settings;
}

function render(settings: Settings, t: Strings) {
  const endpoint = resolveEndpoint(settings);
  $('endpoint').textContent = endpointLabel(settings, t);
  $('endpoint').title = `${endpoint.baseUrl}${endpoint.path}`;
  $('model').textContent = endpoint.model || '—';
  $('scope').textContent = settings.scanScope === 'replies-only' ? t.scopeReplies : t.scopeAll;
  $('status').textContent = !settings.enabled
    ? t.off
    : settings.prefilterOnly
      ? `${t.on} · ${t.prefilterOnly}`
      : t.on;
}

function isXUrl(url: string | undefined): boolean {
  if (!url) return true; // tab URL not readable (no tabs permission): let the message decide
  return /^https:\/\/(x|twitter)\.com\//.test(url);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan(t: Strings) {
  const button = $('scan') as HTMLButtonElement;
  button.disabled = true;
  note(t.scanning);
  try {
    const tab = await activeTab();
    if (!tab?.id) {
      note(t.scanFailed, true);
      return;
    }
    if (!isXUrl(tab.url)) {
      note(t.notXTab, true);
      return;
    }
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: 'ANTI_SLOP_SCAN_NOW',
    })) as { ok?: boolean; scanned?: number } | undefined;
    const count = typeof resp?.scanned === 'number' ? resp.scanned : 0;
    if (resp?.ok && count > 0) {
      note(t.scanned(count));
    } else if (resp?.ok) {
      note(t.scannedZero, true);
    } else {
      note(t.scanFailed, true);
    }
  } catch {
    note(t.noContentScript, true);
  } finally {
    button.disabled = false;
  }
}

async function main() {
  const t = STR[lang()];
  applyLabels(t);

  const settings = await loadSettings();
  render(settings, t);

  if (isPresetName(settings.endpointPreset)) {
    $('endpoint').title = `${ENDPOINT_PRESETS[settings.endpointPreset].baseUrl}${
      ENDPOINT_PRESETS[settings.endpointPreset].path
    }`;
  }

  $('scan').addEventListener('click', () => void scan(t));
  $('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
}

void main();
