import { DEFAULT_SETTINGS, type EndpointPreset, type Settings } from '../../lib/types';
import { loadSettings, saveSettingsViaBackground, settingsKey } from '../../lib/settings';
import { diffRuleEdits, validRuleHandle } from '../../lib/account-rules';
import { credentialCrossesOrigin, ENDPOINT_PRESETS, isPresetName, resolveEndpoint } from '../../lib/endpoints';
import { endpointUrl, recognizeUpstream } from '../../lib/recognizer-client';
import { configProblem, requestFingerprint, type ConfigProblem } from '../../lib/scorer';
import { outcomeLabel } from '../../lib/debug';
import { outcomeCode } from '../../lib/diagnostics';
import { uiT } from '../../lib/i18n-ui';
import type { RecognitionInput } from '../../lib/recognition';
import { hasOriginAccess, originPattern, requestOriginAccess } from '../../lib/permissions';

/**
 * The only content "Test connection" ever sends: a synthetic post written for
 * this purpose, with no context. Never a real post from the page.
 */
export const SYNTHETIC_TEST_INPUT: RecognitionInput = {
  sources: {
    post: { state: 'available', text: 'Reply YES and follow me to get the secret free-flight list!' },
    parent: { state: 'not-applicable' },
    root: { state: 'not-applicable' },
    quote: { state: 'not-applicable' },
  },
  required: ['post'],
};

const STR: Record<'en' | 'zh', Record<string, string>> = {
  en: {
    optionsTitle: 'Anti Slop for X',
    optionsSubtitle: 'Mark possible low-quality posts on X with checkable evidence',
    sectionBehavior: 'Behavior',
    enabled: 'Enable',
    autoScan: 'Auto-scan (check posts as they scroll into view)',
    prefilterOnly: 'Model use off',
    prefilterOnlyHint: 'Nothing is sent to any model, including manual scans and debug mode. There is no local keyword fallback: posts are simply not checked.',
    skipShortText: 'Don’t send posts shorter than {n} characters',
    skipShortTextHint: 'A privacy and cost preference, not a quality judgment: short posts are never sent and never marked.',
    skipOwnPosts: 'Don’t send or mark my own posts',
    scanScope: 'Scan scope',
    scopeReplies: 'Replies only',
    scopeAll: 'Timeline + replies',
    scanMode: 'Mode',
    modeManual: 'Mark only — show a mark with evidence; you decide',
    modeShadow: 'Record only — change nothing on the page',
    scanModeHint: 'No mode automatically folds on a model judgment or blocks accounts. Your hide rules can still fold locally. Earlier “Auto fold” and “Strict” settings now work as Record only until an independent evaluation supports model folding.',
    sectionModel: 'Recognition model',
    modelIntro: 'Recognition needs the OpenAI Responses protocol with structured output, so every judgment can cite the exact text it relies on. TypeSafe / Jev and OpenAI Decisions stay selectable for existing settings but cannot return checkable evidence, so nothing is sent with them.',
    endpointPreset: 'Endpoint',
    presetResponses: 'OpenAI Responses',
    presetJev: 'TypeSafe / Jev (not supported)',
    presetOpenAI: 'OpenAI Decisions (not supported)',
    presetCustom: 'Custom endpoint',
    protocol: 'Protocol',
    protocolResponses: 'OpenAI Responses (structured output)',
    protocolJev: 'TypeSafe / Jev (not supported)',
    protocolDecisions: 'OpenAI Decisions (not supported)',
    upstreamBaseUrl: 'Base URL',
    upstreamPath: 'Path',
    model: 'Model',
    modelHint: 'Required for OpenAI Responses, with no default: enter a model your account can use with structured outputs. The extension does not check which models work.',
    apiKey: 'Your own API key (stored in this browser only)',
    defaultPrompt: 'Legacy prompt (kept, not sent)',
    defaultPromptHint: 'Kept exactly as stored by earlier versions. The recognizer uses its own fixed instructions and never sends this text.',
    sectionRules: 'Your rules',
    rulesIntro: 'Rules are local. Keep wins when an account is in both lists. Neither list mutes or blocks anyone on X.',
    whitelistHelp: 'Always keep: never mark, hide or send (one handle per line, without @)',
    hideListHelp: 'Hide locally: fold in Mark only mode (one handle per line, without @)',
    hideListHint: 'Posts by these accounts are folded locally and never sent to the model. A fold is always reversible from its card, and a post you are already reading is marked instead of folded. Record only mode does not fold.',
    save: 'Save',
    testProxy: 'Test connection',
    testHint: 'Test connection sends one synthetic post (not from X) to the selected endpoint. The extension and model use must be enabled and saved first.',
    confirmKeyOrigin: 'The existing API key will be used with {origin}. Continue?',
    settingsChanged: 'Settings changed. Review them before testing again.',
    saveStale: 'The model settings changed elsewhere. Reload this page and review your edits.',
    invalidRule: 'Invalid account handle. Use 1–15 letters, digits or underscores, one per line.',
    legacyRulesInvalid: 'Some saved account handles are invalid or do not apply. Remove or correct them.',
    legacyMultiline: 'This list contains a multiline legacy entry. Clear the list before adding valid handles.',
    rulesEquivalent: 'Account handles are case-insensitive; order, blank and duplicate lines do not change a rule.',
    rulesBatch: 'Change at most 5,000 account entries per save.',
    rulesLimit: 'A list can contain at most 5,000 entries. Reduce an oversized list before adding more.',
    st_unsaved: 'Unsaved model or switch changes. Saved settings remain active until you save.',
    st_changed: 'Settings changed elsewhere. This form may not reflect the saved values.',
    saved: 'Saved',
    testing: 'Testing…',
    testOk: 'Model replied',
    testFail: 'Request failed',
    testNoPerm: 'Chrome host access was denied for that origin',
    badUrl: 'Invalid base URL',
    st_ok: 'Configuration ready. Checked posts may be sent to {url} with model “{model}”.',
    st_checking_permission: 'Checking Chrome host access…',
    st_permission: 'Chrome host access is missing or unavailable. Save or test to request it.',
    st_disabled: 'The extension is disabled. Nothing is sent.',
    st_user_opted_out: 'Model use is off. Nothing is sent.',
    st_unsupported_protocol: 'Not supported: this protocol cannot return checkable evidence, so nothing is sent. Choose OpenAI Responses.',
    st_missing_key: 'Add your API key. Nothing is sent without one.',
    st_missing_model: 'Enter a model. Nothing is sent without one.',
    st_invalid_config: 'This URL is not usable: it must be https (http only for localhost), without credentials, fragments or path tricks.',
  },
  zh: {
    optionsTitle: 'Anti Slop for X',
    optionsSubtitle: '用可核对的证据标记 X 上可能的低质量内容',
    sectionBehavior: '行为',
    enabled: '启用',
    autoScan: '自动扫描（内容滚入视野时检查）',
    prefilterOnly: '关闭模型调用',
    prefilterOnlyHint: '不向任何模型发送内容，手动扫描与调试模式也一样。没有本地关键词兜底：内容只是不被检查。',
    skipShortText: '不发送少于 {n} 个字符的帖子',
    skipShortTextHint: '这是隐私与费用偏好，不是质量判断：短帖既不发送，也不标记。',
    skipOwnPosts: '不发送、不标记我自己的帖子',
    scanScope: '扫描范围',
    scopeReplies: '仅回复',
    scopeAll: '时间线 + 回复',
    scanMode: '模式',
    modeManual: '仅标记 —— 显示带证据的标记，由你决定',
    modeShadow: '仅记录 —— 不改动页面',
    scanModeHint: '没有模式会按模型判断自动折叠或屏蔽账号，你的隐藏规则仍可本地折叠。旧版的“自动折叠”和“严格”设置现在按“仅记录”运行，直到独立评估支持模型自动折叠。',
    sectionModel: '识别模型',
    modelIntro: '识别需要支持结构化输出的 OpenAI Responses 协议，这样每个判断都能引用它依据的原文。TypeSafe / Jev 与 OpenAI Decisions 为兼容旧设置仍可选择，但无法返回可核对的证据，选中时不会发送任何内容。',
    endpointPreset: '端点',
    presetResponses: 'OpenAI Responses',
    presetJev: 'TypeSafe / Jev（不支持）',
    presetOpenAI: 'OpenAI Decisions（不支持）',
    presetCustom: '自定义端点',
    protocol: '协议类型',
    protocolResponses: 'OpenAI Responses（结构化输出）',
    protocolJev: 'TypeSafe / Jev（不支持）',
    protocolDecisions: 'OpenAI Decisions（不支持）',
    upstreamBaseUrl: 'Base URL',
    upstreamPath: '路径',
    model: '模型名',
    modelHint: 'OpenAI Responses 必填，没有默认值：填写你的账号可用、支持结构化输出的模型。扩展不会替你检查哪些模型可用。',
    apiKey: '你自己的 API Key（仅存本浏览器）',
    defaultPrompt: '旧版提示词（保留，不发送）',
    defaultPromptHint: '按旧版本保存的原样保留。识别器使用自己的固定指令，从不发送这段文字。',
    sectionRules: '你的规则',
    rulesIntro: '规则只在本地生效。同一账号同时在两个名单里时，以“始终保留”为准。两个名单都不会在 X 上静音或屏蔽任何人。',
    whitelistHelp: '始终保留：不标记、不隐藏、不发送（每行一个用户名，不要 @）',
    hideListHelp: '本地隐藏：在“仅标记”模式下折叠（每行一个用户名，不要 @）',
    hideListHint: '这些账号的内容只在本地折叠，不会发给模型。折叠随时可以从卡片上展开；你正在阅读的内容只加标记、不折叠。“仅记录”模式不会折叠。',
    save: '保存',
    testProxy: '测试连接',
    testHint: '“测试连接”只向选中的端点发送一条合成帖子。请先启用并保存扩展和模型调用。',
    confirmKeyOrigin: '现有 API Key 将用于 {origin}。是否继续？',
    settingsChanged: '设置已发生变化，请检查后重新测试。',
    saveStale: '模型设置已在其他页面更改。请重新加载此页面并检查修改。',
    invalidRule: '账号用户名无效。请每行填写 1–15 个字母、数字或下划线。',
    legacyRulesInvalid: '部分已保存的账号用户名无效或不会生效，请删除或修正。',
    legacyMultiline: '该名单含有跨行的旧用户名，请先清空名单，再添加有效用户名。',
    rulesEquivalent: '账号用户名不区分大小写，顺序、空行和重复行不会改变规则。',
    rulesBatch: '每次保存最多修改 5,000 个账号条目。',
    rulesLimit: '每个名单最多包含 5,000 个条目。超限的旧名单需先缩小，再添加条目。',
    st_unsaved: '模型或开关设置尚未保存，保存前仍使用已保存的设置。',
    st_changed: '设置已在其他页面更改，此表单可能不是已保存的值。',
    saved: '已保存',
    testing: '测试中…',
    testOk: '模型已响应',
    testFail: '请求失败',
    testNoPerm: 'Chrome 未授予该 origin 的访问权限',
    badUrl: 'Base URL 无效',
    st_ok: '配置已就绪。被检查的内容可能发往 {url}，模型为“{model}”。',
    st_checking_permission: '正在检查 Chrome 站点访问权限…',
    st_permission: '缺少 Chrome 站点访问权限或无法检查。请保存或测试以申请权限。',
    st_disabled: '扩展已停用，不会发送任何内容。',
    st_user_opted_out: '已关闭模型调用，不会发送任何内容。',
    st_unsupported_protocol: '不支持：该协议无法返回可核对的证据，因此不会发送任何内容。请选择 OpenAI Responses。',
    st_missing_key: '请填写 API Key，否则不会发送任何内容。',
    st_missing_model: '请填写模型名，否则不会发送任何内容。',
    st_invalid_config: '这个 URL 无法使用：必须是 https（仅 localhost 可用 http），不能带账号密码、片段或路径跳转。',
  },
};

function lang(): 'en' | 'zh' {
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function str(key: string): string {
  return STR[lang()][key] ?? STR.en[key] ?? key;
}

function $(id: string) {
  return document.getElementById(id)!;
}

let stored: Settings = { ...DEFAULT_SETTINGS };
let formBaseline: Partial<Settings> = {};
let ruleTextBaseline = { accountWhitelist: '', accountHideList: '' };
let optionsSaving = false;
let connectionTesting = false;
let connectionRevision = 0;
let settingsEpoch = 0;
let acknowledgedSettingsEpoch = 0;
let formReady = false;

function applyI18n() {
  document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && STR[lang()][key]) el.textContent = STR[lang()][key];
  });
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
}

function handleList(id: string): string[] {
  return ($(id) as HTMLTextAreaElement).value
    .split('\n')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}

/** Everything the form edits. The legacy prompt and threshold are never written from here. */
function readForm(): Partial<Settings> {
  return {
    enabled: ($('enabled') as HTMLInputElement).checked,
    autoScan: ($('autoScan') as HTMLInputElement).checked,
    prefilterOnly: ($('prefilterOnly') as HTMLInputElement).checked,
    skipShortText: ($('skipShortText') as HTMLInputElement).checked,
    skipOwnPosts: ($('skipOwnPosts') as HTMLInputElement).checked,
    scanScope: ($('scanScope') as HTMLSelectElement).value as Settings['scanScope'],
    scanMode: ($('scanMode') as HTMLSelectElement).value as Settings['scanMode'],
    protocol: ($('protocol') as HTMLSelectElement).value as Settings['protocol'],
    endpointPreset: ($('endpointPreset') as HTMLSelectElement).value as EndpointPreset,
    upstreamBaseUrl: ($('upstreamBaseUrl') as HTMLInputElement).value.trim(),
    upstreamPath: ($('upstreamPath') as HTMLInputElement).value.trim(),
    model: ($('model') as HTMLInputElement).value.trim(),
    apiKey: ($('apiKey') as HTMLInputElement).value,
    accountWhitelist: handleList('accountWhitelist'),
    accountHideList: handleList('accountHideList'),
  };
}

function ruleText(id: 'accountWhitelist' | 'accountHideList'): string {
  return ($(id) as HTMLTextAreaElement).value;
}

function editedRules(id: 'accountWhitelist' | 'accountHideList', previous: string[]): string[] {
  const text = ruleText(id);
  if (text === ruleTextBaseline[id]) return previous;
  if (text === '') return [];
  const invalid = new Set(previous.filter((handle) => !validRuleHandle(handle)));
  return text.split('\n')
    .map((line) => invalid.has(line) ? line : line.trim().replace(/^@/, ''))
    .filter((handle) => handle.length > 0 || invalid.has(handle));
}

function captureFormBaseline(): void {
  formBaseline = readForm();
  ruleTextBaseline = { accountWhitelist: ruleText('accountWhitelist'), accountHideList: ruleText('accountHideList') };
}

function changedForm(form: Partial<Settings>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  for (const [key, value] of Object.entries(form)) {
    const original = (formBaseline as Record<string, unknown>)[key];
    if (JSON.stringify(value) !== JSON.stringify(original)) Object.assign(patch, { [key]: value });
  }
  return patch;
}

function fillForm(s: Settings) {
  ($('enabled') as HTMLInputElement).checked = s.enabled;
  ($('autoScan') as HTMLInputElement).checked = s.autoScan;
  ($('prefilterOnly') as HTMLInputElement).checked = s.prefilterOnly;
  ($('skipShortText') as HTMLInputElement).checked = s.skipShortText;
  $('skipShortTextLabel').textContent = str('skipShortText').replace('{n}', String(s.shortTextMaxChars));
  ($('skipOwnPosts') as HTMLInputElement).checked = s.skipOwnPosts;
  ($('scanScope') as HTMLSelectElement).value = s.scanScope;
  ($('scanMode') as HTMLSelectElement).value = s.scanMode === 'manual' ? 'manual' : 'shadow';
  ($('protocol') as HTMLSelectElement).value = s.protocol;
  ($('endpointPreset') as HTMLSelectElement).value = s.endpointPreset;
  applyPreset(s.endpointPreset, s);
  ($('apiKey') as HTMLInputElement).value = s.apiKey;
  ($('defaultPrompt') as HTMLTextAreaElement).value = s.defaultPrompt;
  ($('accountWhitelist') as HTMLTextAreaElement).value = s.accountWhitelist.join('\n');
  ($('accountHideList') as HTMLTextAreaElement).value = s.accountHideList.join('\n');
}

function hasInvalidStoredRules(settings: Settings): boolean {
  return [...settings.accountWhitelist, ...settings.accountHideList].some((handle) => handle.trim().length > 0 && !validRuleHandle(handle));
}

function setStatus(msg: string) {
  $('status').textContent = msg;
}

function syncTestButton(): void {
  const button = $('test') as HTMLButtonElement;
  button.disabled = connectionTesting || optionsSaving;
  button.setAttribute('aria-busy', String(connectionTesting));
}

/** The settings the form describes right now, before saving. */
function formSettings(): Settings {
  return { ...stored, ...readForm() };
}

function problemMessage(problem: ConfigProblem): string {
  return str(`st_${problem}`);
}

function confirmCredentialDestination(next: Settings): boolean {
  if (!credentialCrossesOrigin(stored, next)) return true;
  let origin = '';
  try { origin = new URL(resolveEndpoint(next).baseUrl).origin; } catch { return false; }
  return window.confirm(str('confirmKeyOrigin').replace('{origin}', origin));
}

let endpointStatusRevision = 0;

/** Show configuration and the current host grant without making a model request. */
function renderEndpointStatus() {
  const revision = ++endpointStatusRevision;
  const s = formSettings();
  const problem = configProblem(s);
  const endpoint = resolveEndpoint(s);
  const status = $('endpointStatus');
  if (settingsEpoch !== acknowledgedSettingsEpoch) {
    status.textContent = str('st_changed');
    status.classList.add('warn');
    return;
  }
  if (s.enabled !== stored.enabled || s.prefilterOnly !== stored.prefilterOnly ||
    requestFingerprint(s) !== requestFingerprint(stored) || s.apiKey !== stored.apiKey) {
    status.textContent = str('st_unsaved');
    status.classList.add('warn');
    return;
  }
  if (!s.enabled) {
    status.textContent = str('st_disabled');
    status.classList.remove('warn');
    return;
  }
  if (problem) {
    status.textContent = problemMessage(problem);
    status.classList.toggle('warn', problem !== 'user_opted_out');
    return;
  }
  status.textContent = str('st_checking_permission');
  status.classList.remove('warn');
  void hasOriginAccess(endpoint.baseUrl).then((allowed) => {
    if (revision !== endpointStatusRevision) return;
    const url = endpointUrl(endpoint.baseUrl, endpoint.path) ?? '';
    status.textContent = allowed
      ? str('st_ok').replace('{url}', url).replace('{model}', endpoint.model.trim())
      : str('st_permission');
    status.classList.toggle('warn', !allowed);
  });
}

async function main() {
  applyI18n();
  if (typeof chrome !== 'undefined') {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes[settingsKey()]) return;
      settingsEpoch++;
      connectionRevision++;
      const epoch = settingsEpoch;
      if (formReady) renderEndpointStatus();
      void loadSettings().then((latest) => {
        if (epoch !== settingsEpoch || JSON.stringify(latest) !== JSON.stringify(stored)) return;
        acknowledgedSettingsEpoch = epoch;
        if (formReady) renderEndpointStatus();
      }).catch(() => undefined);
    });
  }
  const loadedEpoch = settingsEpoch;
  stored = await loadSettings();
  acknowledgedSettingsEpoch = loadedEpoch;
  fillForm(stored);
  captureFormBaseline();
  formReady = true;
  renderEndpointStatus();
  if (hasInvalidStoredRules(stored)) setStatus(str('legacyRulesInvalid'));

  $('endpointPreset').addEventListener('change', () => {
    // No `from`: switching to custom keeps the values already on screen.
    applyPreset(($('endpointPreset') as HTMLSelectElement).value as EndpointPreset);
    connectionRevision++;
    renderEndpointStatus();
  });
  const onSettingsInput = () => { connectionRevision++; renderEndpointStatus(); };
  for (const id of ['enabled', 'protocol', 'upstreamBaseUrl', 'upstreamPath', 'model', 'apiKey', 'prefilterOnly']) {
    $(id).addEventListener('input', onSettingsInput);
    $(id).addEventListener('change', onSettingsInput);
  }

  $('save').addEventListener('click', () => {
    if (optionsSaving) return;
    connectionRevision++;
    const form = readForm();
    const patch = changedForm(form);
    const lists = ['accountWhitelist', 'accountHideList'] as const;
    if (lists.some((list) => stored[list].some((handle) => /[\r\n]/.test(handle)) &&
      ruleText(list) !== ruleTextBaseline[list] && ruleText(list).trim() !== '')) {
      setStatus(str('legacyMultiline'));
      return;
    }
    const ruleEdits = diffRuleEdits(
      { accountWhitelist: stored.accountWhitelist, accountHideList: stored.accountHideList },
      { accountWhitelist: editedRules('accountWhitelist', stored.accountWhitelist), accountHideList: editedRules('accountHideList', stored.accountHideList) },
    );
    const equivalentRulesChanged = lists.some((list) => ruleText(list) !== ruleTextBaseline[list] && !ruleEdits[list]);
    if (Object.values(ruleEdits).some((edit) => edit.add.length > 5000 || edit.remove.length > 5000)) {
      setStatus(str('rulesBatch'));
      return;
    }
    if (Object.values(ruleEdits).some((edit) => edit.add.some((handle) => !validRuleHandle(handle)))) {
      setStatus(str('invalidRule'));
      return;
    }
    delete patch.accountWhitelist;
    delete patch.accountHideList;
    const basis = requestFingerprint(stored);
    const next = { ...stored, ...form };
    const endpoint = resolveEndpoint(next);
    if (originPattern(endpoint.baseUrl) === null) {
      setStatus(`${str('badUrl')}: ${endpoint.baseUrl}`);
      return;
    }
    if (!confirmCredentialDestination(next)) return;
    // Host permission must be requested inside the click gesture.
    const wantsAccess = next.enabled && endpoint.protocol === 'openai-responses' && !next.prefilterOnly;
    let granted: Promise<boolean>;
    try { granted = wantsAccess ? requestOriginAccess(endpoint.baseUrl).catch(() => false) : Promise.resolve(true); }
    catch { granted = Promise.resolve(false); }
    const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button'));
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    optionsSaving = true;
    void (async () => {
      try {
        await saveSettingsViaBackground(patch, basis, ruleEdits);
        const ok = await granted;
        const loadedEpoch = settingsEpoch;
        stored = await loadSettings();
        acknowledgedSettingsEpoch = loadedEpoch;
        controls.forEach((control, index) => { control.disabled = disabled[index]; });
        fillForm(stored);
        captureFormBaseline();
        renderEndpointStatus();
        const notes = [
          ok ? str('saved') : `${str('saved')} — ${str('testNoPerm')}`,
          equivalentRulesChanged ? str('rulesEquivalent') : '',
          hasInvalidStoredRules(stored) ? str('legacyRulesInvalid') : '',
        ];
        setStatus(notes.filter(Boolean).join(' '));
      } catch (error) {
        controls.forEach((control, index) => { control.disabled = disabled[index]; });
        setStatus(error instanceof Error && error.message === 'stale' ? str('saveStale') :
          error instanceof Error && error.message === 'rules_limit' ? str('rulesLimit') : str('testFail'));
      } finally {
        optionsSaving = false;
        syncTestButton();
      }
    })();
  });

  $('test').addEventListener('click', () => {
    if (connectionTesting || optionsSaving) return;
    // Only the endpoint selected on screen, only with the synthetic post.
    const s = formSettings();
    const endpoint = resolveEndpoint(s);
    if (!stored.enabled || !s.enabled) {
      setStatus(str('st_disabled'));
      return;
    }
    if (stored.prefilterOnly || s.prefilterOnly) {
      setStatus(problemMessage('user_opted_out'));
      return;
    }
    const problem = configProblem(s);
    if (problem) {
      setStatus(problemMessage(problem));
      return;
    }
    if (!confirmCredentialDestination(s)) return;
    const revision = connectionRevision;
    connectionTesting = true;
    syncTestButton();
    // Same gesture rule as Save; resolves true without prompting when already granted.
    let granted: Promise<boolean>;
    try { granted = requestOriginAccess(endpoint.baseUrl).catch(() => false); }
    catch { granted = Promise.resolve(false); }
    void (async () => {
      try {
        const allowed = await granted;
        if (revision !== connectionRevision) return;
        if (!allowed) {
          setStatus(str('testNoPerm'));
          return;
        }
        const latest = await loadSettings();
        if (revision !== connectionRevision) return;
        const currentForm = formSettings();
        if (!latest.enabled || !currentForm.enabled) {
          setStatus(str('st_disabled'));
          return;
        }
        if (latest.prefilterOnly || currentForm.prefilterOnly) {
          setStatus(problemMessage('user_opted_out'));
          return;
        }
        if (requestFingerprint(latest) !== requestFingerprint(stored) || latest.apiKey !== stored.apiKey ||
          requestFingerprint(currentForm) !== requestFingerprint(s) || currentForm.apiKey !== s.apiKey) {
          setStatus(str('settingsChanged'));
          return;
        }
        setStatus(str('testing'));
        const result = await recognizeUpstream(SYNTHETIC_TEST_INPUT, {
          protocol: endpoint.protocol,
          baseUrl: endpoint.baseUrl,
          path: endpoint.path,
          model: endpoint.model,
          apiKey: s.apiKey,
          modelUse: true,
        });
        if (revision !== connectionRevision) return;
        const after = await loadSettings();
        if (revision !== connectionRevision) return;
        const formAfter = formSettings();
        if (!after.enabled || after.prefilterOnly || !formAfter.enabled || formAfter.prefilterOnly ||
          requestFingerprint(after) !== requestFingerprint(stored) || after.apiKey !== stored.apiKey ||
          requestFingerprint(formAfter) !== requestFingerprint(s) || formAfter.apiKey !== s.apiKey) {
          setStatus(str('settingsChanged'));
          return;
        }
        const label = outcomeLabel(result.status, outcomeCode(result), uiT(lang()));
        const ok = result.status === 'classified' || (result.status === 'abstained' && result.cause === 'model');
        setStatus(`${ok ? str('testOk') : str('testFail')}: ${label}`);
      } catch (e) {
        if (revision === connectionRevision) setStatus(`${str('testFail')}: ${(e as Error).message}`);
      } finally {
        if (revision !== connectionRevision && $('status').textContent === str('testing')) setStatus(str('settingsChanged'));
        connectionTesting = false;
        syncTestButton();
      }
    })();
  });
}

void main();
