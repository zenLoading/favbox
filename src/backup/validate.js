import { BACKUP_FORMAT, BACKUP_VERSION } from './format';

/*
 * A backup file is untrusted input: it may be damaged, edited by hand or crafted.
 * Validation builds a new object from known fields only (so `__proto__` or extra
 * keys are never copied), rejects the whole file on structural problems, and
 * skips single bookmarks or fields that are invalid.
 */

export const LIMITS = Object.freeze({
  maxChars: 200 * 1024 * 1024,
  maxDepth: 50,
  maxNodes: 200000,
  maxTitle: 4096,
  maxUrl: 8192,
  maxNotes: 1024 * 1024,
  maxText: 10000,
  maxImage: 2 * 1024 * 1024,
  maxKeywords: 100,
  maxKeywordLength: 100,
  maxMeta: 100,
  maxSkippedItems: 100,
});

// Codes only: the UI maps them to (translatable) messages
export const ERROR = Object.freeze({
  TOO_LARGE: 'TOO_LARGE',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_FORMAT: 'INVALID_FORMAT',
  NOT_A_BACKUP: 'NOT_A_BACKUP',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  TOO_DEEP: 'TOO_DEEP',
  TOO_MANY_NODES: 'TOO_MANY_NODES',
});

export const SKIP = Object.freeze({
  INVALID_NODE: 'INVALID_NODE',
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_URL: 'UNSUPPORTED_URL',
});

const WEB_PROTOCOLS = new Set(['http:', 'https:']);
// SVG is excluded: it can carry scripts
const RASTER_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i;
// Largest timestamp a Date can hold
const MAX_TIMESTAMP = 8.64e15;

const SETTINGS_RULES = {
  fontSize: (v) => ['sm', 'md', 'lg'].includes(v),
  viewMode: (v) => ['masonry', 'card', 'list'].includes(v),
  skipDeleteConfirmation: (v) => typeof v === 'boolean',
  theme: (v) => ['light', 'dark', 'auto'].includes(v),
};

class FatalError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

const isWebUrl = (value, limits) => {
  if (typeof value !== 'string' || value.length > limits.maxUrl) return false;
  try {
    return WEB_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
};

const isImage = (value, limits) => typeof value === 'string'
  && value.length <= limits.maxImage
  && (RASTER_DATA_URL.test(value) || isWebUrl(value, limits));

/**
 * @returns {string|null} A skip reason, or null when the url is a web url.
 */
const urlProblem = (value, limits) => {
  if (typeof value !== 'string' || value.length > limits.maxUrl) return SKIP.INVALID_URL;
  try {
    return WEB_PROTOCOLS.has(new URL(value).protocol) ? null : SKIP.UNSUPPORTED_URL;
  } catch {
    return SKIP.INVALID_URL;
  }
};

// Each rule returns the sanitized value, or undefined to drop the field
const DATA_RULES = {
  notes: (v, l) => (typeof v === 'string' && v.length <= l.maxNotes ? v : undefined),
  pinned: (v) => {
    if (v === true || v === 1) return 1;
    if (v === false || v === 0) return 0;
    return undefined;
  },
  description: (v, l) => (typeof v === 'string' && v.length <= l.maxText ? v : undefined),
  favicon: (v, l) => (isImage(v, l) ? v : undefined),
  image: (v, l) => (isImage(v, l) ? v : undefined),
  keywords: (v, l) => (Array.isArray(v)
    ? v.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= l.maxKeywordLength)
      .slice(0, l.maxKeywords)
    : undefined),
  httpStatus: (v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? v : undefined),
};

const validateData = (data, ctx) => Object.fromEntries(
  Object.entries(DATA_RULES)
    .filter(([field]) => data[field] !== undefined)
    .map(([field, rule]) => {
      const value = rule(data[field], ctx.limits);
      if (value === undefined) ctx.droppedFields += 1;
      return [field, value];
    })
    .filter(([, value]) => value !== undefined),
);

const skip = (node, reason, ctx) => {
  ctx.skipped.count += 1;
  if (ctx.skipped.items.length < ctx.limits.maxSkippedItems) {
    const title = isObject(node) ? text(node.title, ctx.limits.maxTitle) : '';
    const url = isObject(node) && typeof node.url === 'string' ? node.url.slice(0, ctx.limits.maxUrl) : undefined;
    ctx.skipped.items.push({ title, ...(url !== undefined && { url }), reason });
  }
  return null;
};

const validateBookmark = (node, ctx) => {
  const problem = urlProblem(node.url, ctx.limits);
  if (problem) return skip(node, problem, ctx);

  const { dateAdded } = node;
  const hasValidDate = Number.isFinite(dateAdded) && dateAdded >= 0 && dateAdded <= MAX_TIMESTAMP;
  if (dateAdded !== undefined && !hasValidDate) ctx.droppedFields += 1;
  return {
    type: 'bookmark',
    title: text(node.title, ctx.limits.maxTitle),
    url: node.url,
    ...(hasValidDate && { dateAdded }),
    ...(isObject(node.data) && { data: validateData(node.data, ctx) }),
  };
};

function validateNode(node, depth, ctx) {
  ctx.nodes += 1;
  if (ctx.nodes > ctx.limits.maxNodes) throw new FatalError(ERROR.TOO_MANY_NODES);
  if (!isObject(node)) return skip(node, SKIP.INVALID_NODE, ctx);
  if (node.type === 'bookmark') return validateBookmark(node, ctx);
  if (node.type !== 'folder') return skip(node, SKIP.INVALID_NODE, ctx);
  if (depth > ctx.limits.maxDepth) throw new FatalError(ERROR.TOO_DEEP);

  const children = Array.isArray(node.children) ? node.children : [];
  return {
    type: 'folder',
    title: text(node.title, ctx.limits.maxTitle),
    children: children.map((child) => validateNode(child, depth + 1, ctx)).filter(Boolean),
  };
}

const validateSettings = (settings) => (isObject(settings)
  ? Object.fromEntries(Object.entries(SETTINGS_RULES)
    .filter(([key, isValid]) => settings[key] !== undefined && isValid(settings[key]))
    .map(([key]) => [key, settings[key]]))
  : {});

const validateEnvelope = (value, limits) => {
  if (!isObject(value)) throw new FatalError(ERROR.INVALID_FORMAT);
  if (value.format !== BACKUP_FORMAT) throw new FatalError(ERROR.NOT_A_BACKUP);
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > BACKUP_VERSION) {
    throw new FatalError(ERROR.UNSUPPORTED_VERSION);
  }
  if (!Array.isArray(value.tree)) throw new FatalError(ERROR.INVALID_FORMAT);

  const { app, source, options } = value;
  return {
    format: BACKUP_FORMAT,
    version: value.version,
    exportedAt: typeof value.exportedAt === 'string' && !Number.isNaN(Date.parse(value.exportedAt))
      ? value.exportedAt
      : null,
    app: { name: text(app?.name, limits.maxMeta), version: text(app?.version, limits.maxMeta) },
    source: { browser: text(source?.browser, limits.maxMeta) },
    options: { includeScreenshots: typeof options?.includeScreenshots === 'boolean' ? options.includeScreenshots : true },
    settings: validateSettings(value.settings),
  };
};

const failure = (code) => ({
  backup: null, error: { code }, skipped: { count: 0, items: [] }, droppedFields: 0,
});

/**
 * Validates a parsed backup.
 * @param {unknown} value
 * @param {typeof LIMITS} [limits]
 * @returns {{backup: object|null, error: {code: string}|null,
 *   skipped: {count: number, items: Array<{title: string, url?: string, reason: string}>},
 *   droppedFields: number}}
 */
export function validateBackup(value, limits = LIMITS) {
  const ctx = {
    limits, nodes: 0, droppedFields: 0, skipped: { count: 0, items: [] },
  };
  try {
    const envelope = validateEnvelope(value, limits);
    const tree = value.tree.map((node) => validateNode(node, 1, ctx)).filter(Boolean);
    return {
      backup: { ...envelope, tree }, error: null, skipped: ctx.skipped, droppedFields: ctx.droppedFields,
    };
  } catch (e) {
    if (e instanceof FatalError) return failure(e.code);
    throw e;
  }
}

/**
 * Parses and validates the text of a backup file.
 * @param {string} content
 * @param {typeof LIMITS} [limits]
 * @returns {ReturnType<typeof validateBackup>}
 */
export function readBackup(content, limits = LIMITS) {
  if (typeof content !== 'string') return failure(ERROR.INVALID_JSON);
  if (content.length > limits.maxChars) return failure(ERROR.TOO_LARGE);
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return failure(ERROR.INVALID_JSON);
  }
  return validateBackup(value, limits);
}
