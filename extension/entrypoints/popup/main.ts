import { loadSettings, saveSettings } from '../../lib/settings';
import { clearActionLog, readActionLog } from '../../lib/action-log';
import { resolveEndpoint } from '../../lib/endpoints';
import type { Settings } from '../../lib/types';

const EN = {
  behavior: 'Suspicious content',
  mode: 'Response to suspicious content',
  modeManual: 'Mark only',
  modeFold: 'Auto fold',
  manualHint: 'Flag suspicious content and keep the original visible.',
  foldHint: (pct: number) => `Fold at ${pct}% or above. You can always expand it.`,
  debugModeHint: 'Debug overrides mode and scope until turned off.',
  scope: 'Scan scope',
  scopeReplies: 'Replies only',
  scopeAll: 'Timeline + replies',
  debug: 'Debug mode',
  debugHint: 'Scores on every text post, without folding.',
  enable: 'Enable Anti Slop for X',
  running: 'Running on X',
  debugging: 'Debug mode is on',
  paused: 'Paused',
  pausedHint: 'Your preferences are kept. Turn on to resume.',
  debugStatusHint: 'Scores only. Nothing is folded or blocked.',
  autoHint: 'Scans new posts as you browse.',
  manualScanHint: 'Scan the current page when you are ready.',
  scan: 'Scan current page',
  settings: 'Model & more settings',
  noKey: 'Add an API key to configure model scoring',
  prefilterOnly: 'Local rules only · no model calls',
  presetJev: 'TypeSafe / Jev',
  presetOpenAI: 'OpenAI Decisions',
  presetCustom: 'Custom',
  autoSaved: 'Saves automatically',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Couldn’t save. Please try again.',
  loading: 'Loading…',
  loadFailed: 'Couldn’t load preferences',
  settingsFailed: 'Couldn’t open settings. Please try again.',
  scanHint: 'Uses your current mode and scope.',
  debugScanHint: 'Scores all text posts; model calls may incur charges.',
  pausedScanHint: 'Turn on Anti Slop to scan this page.',
  notXTab: 'Open an x.com tab to scan posts.',
  noContentScript: 'Reload the X tab after installing or reloading the extension.',
  scanning: 'Scanning…',
  scanned: (n: number) => `Scanned ${n} post${n === 1 ? '' : 's'}.`,
  scannedZero: 'No new posts to scan in this scope. Try scrolling or changing the scope.',
  scanFailed: 'Couldn’t scan this page. Please try again.',
  logTitle: 'Automatic action history',
  logHint: 'Automatic mutes and blocks only',
  logClear: 'Clear',
  logClearHint: 'Clear history without undoing any actions',
  logClearConfirm: 'Confirm clear',
  logEmpty: 'No automatic mutes or blocks yet.',
  logEmptySummary: 'No actions yet',
  logCount: (n: number) => `${n} action${n === 1 ? '' : 's'}`,
  logFailed: 'Couldn’t load action history.',
  logClearFailed: 'Couldn’t clear history. Please try again.',
  undo: 'Undo',
  undoHint: 'Unblock this account and add it to the whitelist',
  undone: 'Undone',
  undoOk: 'Unblocked and added to your whitelist.',
  undoFail: 'Couldn’t undo. Please try again.',
  undoNoTab: 'Open an x.com tab to undo this block.',
  mute: 'Mute',
  block: 'Block',
  failed: 'Failed',
};

type Strings = typeof EN;
const ZH: Strings = {
  behavior: '发现可疑内容时',
  mode: '可疑内容的处理方式',
  modeManual: '仅标记',
  modeFold: '自动折叠',
  manualHint: '标记可疑内容，保留原文，由你决定。',
  foldHint: (pct) => `分数达到 ${pct}% 时折叠，可随时展开。`,
  debugModeHint: '调试期间仅显示评分，关闭后恢复模式与范围。',
  scope: '扫描范围',
  scopeReplies: '仅回复',
  scopeAll: '时间线 + 回复',
  debug: '调试模式',
  debugHint: '显示所有正文推文的评分，不折叠。',
  enable: '启用 Anti Slop for X',
  running: '正在 X 上运行',
  debugging: '调试中',
  paused: '已暂停',
  pausedHint: '偏好已保留，启用后继续运行。',
  debugStatusHint: '只显示评分，不折叠或屏蔽内容。',
  autoHint: '浏览时自动扫描新内容。',
  manualScanHint: '按需扫描当前页面。',
  scan: '扫描当前页',
  settings: '模型与更多设置',
  noKey: '尚未配置 API Key，点击设置模型',
  prefilterOnly: '仅本地规则 · 不调用模型',
  presetJev: 'TypeSafe / Jev',
  presetOpenAI: 'OpenAI Decisions',
  presetCustom: '自定义',
  autoSaved: '更改即时保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '保存失败，请重试',
  loading: '正在读取设置…',
  loadFailed: '无法读取设置',
  settingsFailed: '无法打开设置，请重试。',
  scanHint: '按当前模式与范围扫描。',
  debugScanHint: '调试会扫描所有正文推文，模型调用可能产生费用。',
  pausedScanHint: '启用扩展后即可扫描当前页。',
  notXTab: '请先打开 x.com 页面，再扫描推文。',
  noContentScript: '安装或重载扩展后，请刷新一次 X 标签页。',
  scanning: '扫描中…',
  scanned: (n) => `已扫描 ${n} 条推文。`,
  scannedZero: '当前范围内没有新内容可扫描，可滚动页面或调整范围。',
  scanFailed: '扫描失败，请重试。',
  logTitle: '自动操作记录',
  logHint: '仅记录自动静音与屏蔽',
  logClear: '清空',
  logClearHint: '仅清空记录，不会撤销已执行的操作',
  logClearConfirm: '确认清空',
  logEmpty: '还没有自动静音或屏蔽记录。',
  logEmptySummary: '暂无记录',
  logCount: (n) => `${n} 条记录`,
  logFailed: '无法读取操作记录。',
  logClearFailed: '清空失败，请重试。',
  undo: '撤销',
  undoHint: '解除屏蔽并将此账号加入白名单',
  undone: '已撤销',
  undoOk: '已解除屏蔽，并加入白名单。',
  undoFail: '撤销失败，请重试。',
  undoNoTab: '请先打开一个 x.com 标签页，再撤销屏蔽。',
  mute: '静音',
  block: '屏蔽',
  failed: '失败',
};

const language = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
const t = language === 'zh' ? ZH : EN;
let settings: Settings | undefined;
let saving = false;
let scanning = false;
let tabIsX = true;
let settingsRevision = 0;
let clearArmed = false;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function note(message: string, warn = false) {
  $('note').textContent = message;
  $('note').classList.toggle('warn', warn);
}

function endpointLabel(s: Settings): string {
  if (s.endpointPreset === 'jev-official') return t.presetJev;
  if (s.endpointPreset === 'openai-official') return t.presetOpenAI;
  try {
    return new URL(s.upstreamBaseUrl).host;
  } catch {
    return t.presetCustom;
  }
}

function syncDisabled() {
  const ready = Boolean(settings);
  input('enabled').disabled = !ready || saving;
  input('debugMode').disabled = !ready || saving;
  ($('modeControls') as HTMLFieldSetElement).disabled = !ready || saving || Boolean(settings?.debugMode);
  ($('scanScope') as HTMLSelectElement).disabled = !ready || saving || Boolean(settings?.debugMode);
  ($('scan') as HTMLButtonElement).disabled = !ready || !settings?.enabled || !tabIsX || saving || scanning;
  $('scan').setAttribute('aria-busy', String(scanning));
  $('scanLabel').textContent = scanning ? t.scanning : t.scan;
  ($('settings') as HTMLButtonElement).disabled = saving;
}

function scanHint(s: Settings): string {
  if (!s.enabled) return t.pausedScanHint;
  if (!tabIsX) return t.notXTab;
  if (s.debugMode && !s.prefilterOnly) return t.debugScanHint;
  return s.prefilterOnly ? t.prefilterOnly : t.scanHint;
}

function render(s: Settings) {
  document.body.dataset.state = !s.enabled ? 'paused' : s.debugMode ? 'debug' : 'running';
  $('statusTitle').textContent = !s.enabled ? t.paused : s.debugMode ? t.debugging : t.running;
  $('statusHint').textContent = !s.enabled
    ? t.pausedHint
    : s.debugMode ? t.debugStatusHint : s.autoScan ? t.autoHint : t.manualScanHint;
  input('enabled').checked = s.enabled;
  input('debugMode').checked = s.debugMode;
  document.querySelectorAll<HTMLInputElement>('input[name="scanMode"]').forEach((radio) => {
    radio.checked = radio.value === s.scanMode;
  });
  ($('scanScope') as HTMLSelectElement).value = s.scanScope;
  $('modeHint').textContent = s.debugMode
    ? t.debugModeHint
    : s.scanMode === 'manual' ? t.manualHint : t.foldHint(Math.round(s.threshold * 100));
  const endpoint = resolveEndpoint(s);
  const connection = s.prefilterOnly
    ? t.prefilterOnly
    : !s.apiKey.trim() ? t.noKey : `${endpointLabel(s)} · ${endpoint.model || '—'}`;
  $('connectionDetail').textContent = connection;
  $('connectionDetail').title = connection;
  // This is configuration information, not a claim that the endpoint is reachable.
  $('settings').title = s.prefilterOnly ? t.prefilterOnly : `${endpoint.baseUrl}${endpoint.path}`;
  note(scanHint(s));
  syncDisabled();
}

async function persist(patch: Partial<Settings>) {
  if (!settings || saving) return;
  saving = true;
  settingsRevision++;
  $('saveStatus').textContent = t.saving;
  $('saveStatus').classList.remove('warn');
  syncDisabled();
  try {
    // Controls stay disabled until this write settles, so saveSettings' read/merge/write
    // cannot race another edit from this popup. Only successful writes become the baseline.
    settings = await saveSettings(patch);
    render(settings);
    $('saveStatus').textContent = t.saved;
  } catch {
    render(settings);
    $('saveStatus').textContent = t.saveFailed;
    $('saveStatus').classList.add('warn');
  } finally {
    saving = false;
    syncDisabled();
  }
}

function isXUrl(url: string | undefined): boolean {
  // Without a readable URL, let the content-script message establish availability.
  return !url || /^https:\/\/(x|twitter)\.com\//.test(url);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan() {
  if (!settings?.enabled || saving || scanning) return;
  const revision = settingsRevision;
  scanning = true;
  note(t.scanning);
  syncDisabled();
  try {
    const tab = await activeTab();
    if (!tab?.id) {
      note(t.scanFailed, true);
      return;
    }
    tabIsX = isXUrl(tab.url);
    if (!tabIsX) {
      note(t.notXTab, true);
      return;
    }
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: 'ANTI_SLOP_SCAN_NOW',
    })) as { ok?: boolean; scanned?: number } | undefined;
    if (revision !== settingsRevision) return;
    const count = typeof resp?.scanned === 'number' ? resp.scanned : 0;
    if (resp?.ok && count > 0) note(t.scanned(count));
    else if (resp?.ok) note(t.scannedZero);
    else note(t.scanFailed, true);
  } catch {
    if (revision === settingsRevision) note(t.noContentScript, true);
  } finally {
    scanning = false;
    syncDisabled();
  }
}

async function undoBlock(button: HTMLButtonElement) {
  const status = $('undoNote');
  button.disabled = true;
  status.classList.remove('warn');
  status.textContent = t.saving;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'ANTI_SLOP_UNDO_BLOCK',
      ts: Number(button.dataset.ts),
      handle: button.dataset.handle || '',
    })) as { ok?: boolean; error?: string } | undefined;
    if (res?.ok) {
      status.textContent = t.undoOk;
      await renderLog();
    } else {
      status.classList.add('warn');
      status.textContent = res?.error === 'no-x-tab' ? t.undoNoTab : t.undoFail;
    }
  } catch {
    status.classList.add('warn');
    status.textContent = t.undoFail;
  } finally {
    button.disabled = false;
  }
}

async function renderLog() {
  const entries = await readActionLog();
  const list = $('logList');
  $('logSummary').textContent = entries.length ? t.logCount(entries.length) : t.logEmptySummary;
  ($('clearLog') as HTMLButtonElement).disabled = entries.length === 0;
  clearArmed = false;
  $('clearLog').textContent = t.logClear;
  if (!entries.length) {
    list.innerHTML = `<li class="empty">${t.logEmpty}</li>`;
    return;
  }
  const dates = new Intl.DateTimeFormat(language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  list.innerHTML = entries.slice(0, 8).map((entry) => {
    const action = entry.action === 'block' ? t.block : t.mute;
    const canUndo = entry.action === 'block' && entry.ok;
    const tail = !canUndo ? '' : entry.undone
      ? `<span class="done">${t.undone}</span>`
      : `<button class="act" data-ts="${entry.ts}" data-handle="${escapeHtml(entry.handle)}" title="${t.undoHint}" aria-label="${t.undo} @${escapeHtml(entry.handle)}">${t.undo}</button>`;
    const detail = [action, `${Math.round(entry.score * 100)}%`, dates.format(entry.ts), !entry.ok ? t.failed : ''].filter(Boolean).join(' · ');
    return `<li class="${entry.ok ? '' : 'fail'}"><span class="log-entry"><span class="who" title="@${escapeHtml(entry.handle)}">@${escapeHtml(entry.handle)}</span><span class="entry-detail">${escapeHtml(detail)}</span></span>${tail}</li>`;
  }).join('');
  list.querySelectorAll<HTMLButtonElement>('button.act').forEach((button) => {
    button.addEventListener('click', () => void undoBlock(button));
  });
}

function applyLabels() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const labels: Record<string, string> = {
    lblBehavior: t.behavior, lblMode: t.mode, modeManual: t.modeManual, modeFold: t.modeFold,
    lblScope: t.scope, scopeReplies: t.scopeReplies, scopeAll: t.scopeAll,
    lblDebug: t.debug, debugHint: t.debugHint, scanLabel: t.scan,
    lblSettings: t.settings, lblLog: t.logTitle, logHint: t.logHint, clearLog: t.logClear,
    saveStatus: t.autoSaved, statusTitle: t.loading,
  };
  for (const [id, label] of Object.entries(labels)) $(id).textContent = label;
  input('enabled').setAttribute('aria-label', t.enable);
  $('scan').closest('section')!.setAttribute('aria-label', t.scan);
  $('clearLog').title = t.logClearHint;
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
}

async function main() {
  applyLabels();
  $('settings').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage().catch(() => note(t.settingsFailed, true));
  });
  input('enabled').addEventListener('change', () => void persist({ enabled: input('enabled').checked }));
  input('debugMode').addEventListener('change', () => void persist({ debugMode: input('debugMode').checked }));
  document.querySelectorAll<HTMLInputElement>('input[name="scanMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) void persist({ scanMode: radio.value as Settings['scanMode'] });
    });
  });
  $('scanScope').addEventListener('change', () => {
    void persist({ scanScope: ($('scanScope') as HTMLSelectElement).value as Settings['scanScope'] });
  });
  $('scan').addEventListener('click', () => void scan());
  $('clearLog').addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      $('clearLog').textContent = t.logClearConfirm;
      return;
    }
    ($('clearLog') as HTMLButtonElement).disabled = true;
    void clearActionLog().then(() => renderLog()).catch(() => {
      $('undoNote').textContent = t.logClearFailed;
      $('undoNote').classList.add('warn');
      ($('clearLog') as HTMLButtonElement).disabled = false;
    });
  });
  $('log').addEventListener('toggle', () => {
    if (!($('log') as HTMLDetailsElement).open) {
      clearArmed = false;
      $('clearLog').textContent = t.logClear;
    }
  });

  try {
    settings = await loadSettings();
    render(settings);
  } catch {
    $('statusTitle').textContent = t.loadFailed;
    $('saveStatus').textContent = t.saveFailed;
    $('saveStatus').classList.add('warn');
    return;
  }
  // An unreadable URL is allowed: sendMessage will provide the actionable error.
  try {
    tabIsX = isXUrl((await activeTab())?.url);
    if (!scanning) note(scanHint(settings));
    syncDisabled();
  } catch { /* Defer availability detection to the scan action. */ }
  try {
    await renderLog();
  } catch {
    $('logSummary').textContent = t.logFailed;
  }
}

void main();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
