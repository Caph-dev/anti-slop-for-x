/**
 * Debug mode: a per-post diagnostic of the recognition state.
 *
 * Debug changes how results are shown and overrides auto-scan. It obeys enable,
 * scope, no-send preferences and explicit rules. In shadow mode there are no
 * badges: shadow never changes a post, and its record is in the popup instead.
 */
import { RECOGNITION_SOURCES, isTarget, type ContextState, type Recognition, type RecognitionSource } from './recognition';

export type DiagnosticLevel = 'target' | 'normal' | 'neutral' | 'problem';

export interface DiagnosticLabel {
  level: DiagnosticLevel;
  /** Short badge text, from fixed strings only. */
  text: string;
  /** Hover text: context state of each source. */
  detail: string;
  status: Recognition['status'];
}

function fill(template: string, source: string): string {
  return template.replace('{source}', source);
}

function missingText(missing: RecognitionSource[], context: ContextState, t: (key: string) => string): string {
  return missing
    .map((source) => fill(t(context[source] === 'partial' ? 'incomplete' : 'missingSource'), t(`src_${source}`)))
    .join(', ');
}

export function contextDetail(context: ContextState, t: (key: string) => string): string {
  return RECOGNITION_SOURCES.map((source) => `${t(`src_${source}`)}: ${t(`ctx_${context[source]}`)}`).join(' · ');
}

export function diagnosticLabel(result: Recognition, t: (key: string) => string): DiagnosticLabel {
  const detail = contextDetail(result.context, t);
  switch (result.status) {
    case 'classified':
      return {
        level: isTarget(result) ? 'target' : 'normal',
        text: result.category === 'normal' ? t('cat_normal') : t(`dbg_${result.category}`),
        detail: `${detail}\n${t('modelNote')}`,
        status: result.status,
      };
    case 'abstained':
      return {
        level: 'neutral',
        text: `${t('stAbstained')} · ${result.cause === 'model' ? t('modelUnsure') : missingText(result.missing, result.context, t)}`,
        detail,
        status: result.status,
      };
    case 'unavailable':
      return { level: 'neutral', text: `${t('stNotSent')} · ${t(`r_${result.reason}`)}`, detail, status: result.status };
    case 'failed':
      return { level: 'problem', text: `${t('stFailed')} · ${t(`e_${result.error}`)}`, detail, status: result.status };
  }
}

/** Label for a diagnostics outcome code (`status` + `code`), for the popup. */
export function outcomeLabel(status: string, code: string, t: (key: string) => string): string {
  if (status === 'classified') return code === 'normal' ? t('cat_normal') : t(`dbg_${code}`);
  if (status === 'abstained') return `${t('stAbstained')} · ${code === 'model' ? t('modelUnsure') : t('missingContext')}`;
  if (status === 'unavailable') return `${t('stNotSent')} · ${t(`r_${code}`)}`;
  return `${t('stFailed')} · ${t(`e_${code}`)}`;
}
