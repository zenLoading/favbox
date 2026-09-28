import { extractTags } from '@/services/tags';

/*
 * Netscape bookmark file: the HTML format every browser imports and exports.
 * Titles keep their "🏷 #tag" suffix so importing back into FavBox keeps the tags;
 * tags are also written to the TAGS attribute that Firefox reads.
 */

const HEADER = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>`;

const INDENT = '    ';
const BLOCK_END = /<\/(p|div|li|h[1-6]|blockquote|pre)>|<br\s*\/?>|<hr\s*\/?>/gi;
// Index of the top-level folder that is the bookmarks toolbar
const TOOLBAR_INDEX = { firefox: 1 };

const ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * Converts notes (TipTap HTML) to plain text, one line per block.
 * DOMParser builds an inert document, so nothing in the notes runs.
 * @param {string} html
 * @returns {string}
 */
export function notesToText(html) {
  if (typeof html !== 'string' || html === '') return '';
  const { body } = new DOMParser().parseFromString(html.replace(BLOCK_END, '$&\n'), 'text/html');
  body.querySelectorAll('script, style').forEach((element) => element.remove());
  return body.textContent
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const attributes = (entries) => entries
  .filter(([, value]) => value !== undefined && value !== '')
  .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
  .join('');

const bookmarkLines = (node, indent) => {
  const addDate = Number.isFinite(node.dateAdded) ? Math.floor(node.dateAdded / 1000) : undefined;
  const tags = extractTags(node.title).join(',');
  const link = `${indent}<DT><A${attributes([['HREF', node.url], ['ADD_DATE', addDate], ['TAGS', tags]])}>${escapeHtml(node.title)}</A>`;
  const notes = notesToText(node.data?.notes);
  return notes ? [link, `${indent}<DD>${escapeHtml(notes)}`] : [link];
};

const folderLines = (node, indent, isToolbar = false) => [
  `${indent}<DT><H3${attributes([['PERSONAL_TOOLBAR_FOLDER', isToolbar ? 'true' : undefined]])}>${escapeHtml(node.title)}</H3>`,
  `${indent}<DL><p>`,
  // eslint-disable-next-line no-use-before-define
  ...node.children.flatMap((child) => nodeLines(child, indent + INDENT)),
  `${indent}</DL><p>`,
];

function nodeLines(node, indent) {
  return node.type === 'folder' ? folderLines(node, indent) : bookmarkLines(node, indent);
}

/**
 * Renders a backup (see buildBackup) as a Netscape bookmark file.
 * @param {object} backup
 * @returns {string}
 */
export function toNetscapeHtml(backup) {
  const toolbarIndex = TOOLBAR_INDEX[backup.source?.browser] ?? 0;
  const lines = backup.tree.flatMap((node, index) => (node.type === 'folder'
    ? folderLines(node, INDENT, index === toolbarIndex)
    : bookmarkLines(node, INDENT)));
  return [HEADER, '<DL><p>', ...lines, '</DL><p>', ''].join('\n');
}
