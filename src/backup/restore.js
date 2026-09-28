import BookmarkStorage from '@/storage/bookmark';
import { LIMITS, ERROR, readBackup } from './validate';
import { planRestore } from './plan';
import { applyDataUpdates, applyCreates } from './apply';

export const READ_FAILED = 'READ_FAILED';

const readFileText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

/**
 * Reads, validates and plans a restore from a backup file. Changes nothing.
 * @param {File} file
 * @param {typeof LIMITS} [limits]
 * @returns {Promise<{error: {code: string}}|{error: null, exportedAt: string|null,
 *   skipped: object, droppedFields: number, plan: object}>}
 */
export async function prepareRestore(file, limits = LIMITS) {
  // Bytes are at least as many as characters, so this never lets an oversized file through
  if (file.size > limits.maxChars) return { error: { code: ERROR.TOO_LARGE } };
  let text;
  try {
    text = await readFileText(file);
  } catch (e) {
    console.error('Failed to read backup file', e);
    return { error: { code: READ_FAILED } };
  }
  const validation = readBackup(text, limits);
  if (validation.error) return { error: validation.error };

  const [tree, rows] = await Promise.all([
    browser.bookmarks.getTree(),
    new BookmarkStorage().findAll(),
  ]);
  return {
    error: null,
    exportedAt: validation.backup.exportedAt,
    skipped: validation.skipped,
    droppedFields: validation.droppedFields,
    plan: planRestore(validation.backup, tree, rows),
  };
}

/**
 * Applies a planned restore with the options the user picked.
 * @param {object} plan - planRestore() result.
 * @param {object} [options]
 * @param {boolean} [options.restoreData] - Restore notes, pins and screenshots.
 * @param {boolean} [options.recreateMissing] - Recreate missing bookmarks.
 * @param {string} options.folderTitle - Folder for recreated bookmarks.
 * @param {(progress: {done: number, total: number}) => void} [options.onProgress]
 * @returns {Promise<{updated: number, merged: number, created: number, recreated: number,
 *   folderTitle: string|null, failed: Array<object>}>}
 */
export async function runRestore(plan, {
  restoreData = true, recreateMissing = false, folderTitle, onProgress,
} = {}) {
  const updates = restoreData ? plan.updates : [];
  const creates = recreateMissing ? plan.creates : [];
  const total = updates.length + creates.length;
  const report = {
    updated: 0, merged: 0, created: 0, recreated: 0, folderTitle: null, failed: [],
  };

  if (updates.length > 0) {
    const result = await applyDataUpdates(updates, {
      onProgress: ({ done }) => onProgress?.({ done, total }),
    });
    Object.assign(report, { updated: result.updated, merged: result.merged, created: result.created });
    report.failed.push(...result.failed);
  }
  if (creates.length > 0) {
    const result = await applyCreates(creates, {
      folderTitle,
      onProgress: ({ done }) => onProgress?.({ done: updates.length + done, total }),
    });
    Object.assign(report, { recreated: result.bookmarks, folderTitle });
    report.failed.push(...result.failed);
  }
  return report;
}
