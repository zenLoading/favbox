import { describe, expect, it } from 'vitest';
import { notesToText, toNetscapeHtml } from '@/backup/netscape';

// Not named `browser`: auto-import would inject webextension-polyfill into this file
const backupOf = (tree, sourceBrowser = 'chrome') => ({
  format: 'favbox-backup', version: 1, source: { browser: sourceBrowser }, tree,
});
const bm = (title, url, extra = {}) => ({
  type: 'bookmark', title, url, dateAdded: 1700000000123, ...extra,
});
const dir = (title, children) => ({ type: 'folder', title, children });

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

describe('notesToText', () => {
  it('turns paragraphs, line breaks and list items into lines', () => {
    expect(notesToText('<p>first</p><p>second<br>third</p><ul><li>a</li><li>b</li></ul>'))
      .toBe('first\nsecond\nthird\na\nb');
  });

  it('decodes entities and collapses spaces', () => {
    expect(notesToText('<p>  a &amp;   b  </p>')).toBe('a & b');
  });

  it('returns an empty string for empty editor content', () => {
    expect(notesToText('<p></p>')).toBe('');
    expect(notesToText('')).toBe('');
    expect(notesToText(undefined)).toBe('');
  });

  it('keeps only text from markup such as images or scripts', () => {
    expect(notesToText('<p>x<img src=x onerror="alert(1)"><script>alert(2)</script></p>')).toBe('x');
  });
});

describe('toNetscapeHtml', () => {
  it('writes the Netscape bookmark file header', () => {
    const html = toNetscapeHtml(backupOf([]));

    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
    expect(html).toContain('<H1>Bookmarks</H1>');
  });

  it('writes folders and bookmarks with their hierarchy', () => {
    const html = toNetscapeHtml(backupOf([
      dir('Bookmarks bar', [bm('A', 'https://a.com/'), dir('Dev', [bm('B', 'https://b.com/')])]),
      dir('Other bookmarks', []),
    ]));
    const doc = parse(html);

    const folders = [...doc.querySelectorAll('h3')].map((h3) => h3.textContent);
    expect(folders).toEqual(['Bookmarks bar', 'Dev', 'Other bookmarks']);
    const links = [...doc.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([['A', 'https://a.com/'], ['B', 'https://b.com/']]);
    // B sits in the list that follows the Dev heading
    expect(html.indexOf('>Dev</H3>')).toBeLessThan(html.indexOf('>B</A>'));
    expect(html.match(/<DL><p>/g)).toHaveLength(4);
    expect(html.match(/<\/DL><p>/g)).toHaveLength(4);
  });

  it('writes the add date in seconds, the tags and keeps the title with tags', () => {
    const doc = parse(toNetscapeHtml(backupOf([dir('Bar', [bm('Tokio 🏷 #rust #async', 'https://tokio.rs/')])])));
    const link = doc.querySelector('a');

    expect(link.textContent).toBe('Tokio 🏷 #rust #async');
    expect(link.getAttribute('add_date')).toBe('1700000000');
    expect(link.getAttribute('tags')).toBe('rust,async');
  });

  it('leaves out attributes it has no value for', () => {
    const html = toNetscapeHtml(backupOf([dir('Bar', [bm('A', 'https://a.com/', { dateAdded: undefined })])]));

    expect(html).toContain('<A HREF="https://a.com/">A</A>');
  });

  it('writes notes as a plain text description', () => {
    const html = toNetscapeHtml(backupOf([dir('Bar', [
      bm('A', 'https://a.com/', { data: { notes: '<p>line 1</p><p>line 2 &amp; more</p>' } }),
      bm('B', 'https://b.com/', { data: { notes: '<p></p>' } }),
    ])]));

    expect(html).toContain('<DD>line 1\nline 2 &amp; more');
    expect(html.match(/<DD>/g)).toHaveLength(1);
  });

  it('escapes titles, urls and notes', () => {
    const html = toNetscapeHtml(backupOf([dir('<b>F</b>', [
      bm('<script>alert(1)</script>', 'https://a.com/?q="x"&y=<1>', {
        data: { notes: '<p>&lt;img src=x onerror=alert(1)&gt;</p>' },
      }),
    ])]));
    const doc = parse(html);

    expect(doc.querySelectorAll('script, img, b')).toHaveLength(0);
    expect(doc.querySelector('h3').textContent).toBe('<b>F</b>');
    expect(doc.querySelector('a').textContent).toBe('<script>alert(1)</script>');
    expect(doc.querySelector('a').getAttribute('href')).toBe('https://a.com/?q="x"&y=<1>');
  });

  it('marks the bookmarks bar so other browsers put it back on the toolbar', () => {
    const chrome = parse(toNetscapeHtml(backupOf([dir('Bookmarks bar', []), dir('Other', [])])));
    const firefox = parse(toNetscapeHtml(backupOf(
      [dir('Menu', []), dir('Toolbar', []), dir('Other', [])],
      'firefox',
    )));

    const marked = (doc) => [...doc.querySelectorAll('h3[personal_toolbar_folder="true"]')].map((h) => h.textContent);
    expect(marked(chrome)).toEqual(['Bookmarks bar']);
    expect(marked(firefox)).toEqual(['Toolbar']);
  });
});
