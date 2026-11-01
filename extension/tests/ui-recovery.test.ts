import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { alreadyMounted, mountCard } from '../lib/ui';

afterEach(() => vi.unstubAllGlobals());

describe('post recovery', () => {
  it('restores the original content when a folded card is removed', () => {
    const { document } = parseHTML('<html><body><article><div id="post">Synthetic post</div></article></body></html>');
    vi.stubGlobal('document', document);
    const article = document.querySelector('article') as unknown as HTMLElement;
    const post = document.querySelector('#post') as unknown as HTMLElement;
    mountCard(article, { presentation: 'fold', kind: 'rule', title: 'Hidden by rule', evidence: [], counterevidence: [], handle: 'author' }, {}, (key) => key, '123');
    expect(post.style.display).toBe('none');
    article.querySelector('.anti-slop-bar')?.remove();
    expect(alreadyMounted(article, '123')).toBe(false);
    expect(post.style.display).not.toBe('none');
    expect(article.classList.contains('anti-slop-folded')).toBe(false);
  });

  it('restores the original content when the mount marker is removed', () => {
    const { document } = parseHTML('<html><body><article><div id="post">Synthetic post</div></article></body></html>');
    vi.stubGlobal('document', document);
    const article = document.querySelector('article') as unknown as HTMLElement;
    const post = document.querySelector('#post') as unknown as HTMLElement;
    mountCard(article, { presentation: 'fold', kind: 'rule', title: 'Hidden by rule', evidence: [], counterevidence: [], handle: 'author' }, {}, (key) => key, '123');
    article.removeAttribute('data-anti-slop');
    expect(alreadyMounted(article, '123')).toBe(false);
    expect(post.style.display).not.toBe('none');
    expect(article.classList.contains('anti-slop-folded')).toBe(false);
  });
});
