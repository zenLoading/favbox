<template>
  <div class="flex flex-col gap-5">
    <section aria-labelledby="backup-export-label">
      <h4
        id="backup-export-label"
        class="text-xs font-medium text-gray-500 dark:text-neutral-400"
      >
        {{ TEXT.backupLabel }}
      </h4>
      <p class="mt-1 text-xs text-gray-500 dark:text-neutral-500">
        {{ TEXT.backupDescription }}
      </p>
      <p
        class="mt-1 text-xs text-gray-500 dark:text-neutral-500"
        data-testid="last-backup"
      >
        {{ TEXT.lastBackup }} <span class="font-medium text-black dark:text-white">{{ lastBackupText }}</span>
      </p>
      <label
        for="backup-include-screenshots"
        class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-neutral-300"
      >
        <input
          id="backup-include-screenshots"
          v-model="includeScreenshots"
          type="checkbox"
          class="size-3.5 rounded border-gray-300 text-black focus:ring-0 dark:border-neutral-700 dark:bg-neutral-900"
          data-testid="include-screenshots"
        >
        {{ TEXT.includeScreenshots }}
        <span
          v-if="screenshotBytes"
          class="text-gray-400 dark:text-neutral-500"
        >({{ TEXT.about }} {{ formatBytes(screenshotBytes) }})</span>
      </label>
      <div class="mt-2 flex gap-2">
        <AppButton
          class="flex-1 disabled:cursor-wait disabled:opacity-60"
          :title="TEXT.exportJson"
          :aria-label="TEXT.exportJson"
          :disabled="isBusy"
          data-testid="export-json"
          @click="handleExport('json')"
        >
          {{ exporting === 'json' ? TEXT.exporting : TEXT.exportJson }}
        </AppButton>
        <AppButton
          variant="gray"
          class="flex-1 disabled:cursor-wait disabled:opacity-60"
          :title="TEXT.exportHtmlHint"
          :aria-label="TEXT.exportHtml"
          :disabled="isBusy"
          data-testid="export-html"
          @click="handleExport('html')"
        >
          {{ exporting === 'html' ? TEXT.exporting : TEXT.exportHtml }}
        </AppButton>
      </div>
    </section>

    <section
      aria-labelledby="backup-restore-label"
      aria-live="polite"
    >
      <h4
        id="backup-restore-label"
        class="text-xs font-medium text-gray-500 dark:text-neutral-400"
      >
        {{ TEXT.restoreLabel }}
      </h4>

      <template v-if="step === 'idle' || step === 'preparing'">
        <p class="mt-1 text-xs text-gray-500 dark:text-neutral-500">
          {{ TEXT.restoreDescription }}
        </p>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="sr-only"
          tabindex="-1"
          :aria-label="TEXT.chooseFile"
          data-testid="restore-file"
          @change="handleFile"
        >
        <AppButton
          variant="gray"
          class="mt-2 w-full disabled:cursor-wait disabled:opacity-60"
          :title="TEXT.chooseFile"
          :aria-label="TEXT.chooseFile"
          :disabled="isBusy"
          @click="fileInputRef.click()"
        >
          {{ step === 'preparing' ? TEXT.reading : TEXT.chooseFile }}
        </AppButton>
        <p
          v-if="errorMessage"
          role="alert"
          class="mt-2 text-xs text-red-600 dark:text-red-400"
          data-testid="restore-error"
        >
          {{ errorMessage }}
        </p>
      </template>

      <div
        v-else-if="step === 'preview'"
        class="mt-2 flex flex-col gap-2 rounded-md border border-gray-200 p-3 text-xs text-gray-700 dark:border-neutral-800 dark:text-neutral-300"
        data-testid="restore-preview"
      >
        <p class="text-gray-500 dark:text-neutral-500">
          {{ previewHeading }}
        </p>
        <label
          for="backup-restore-data"
          class="flex items-start gap-2"
          :class="summary.toUpdate === 0 ? 'opacity-50' : 'cursor-pointer'"
        >
          <input
            id="backup-restore-data"
            v-model="restoreData"
            type="checkbox"
            class="mt-0.5 size-3.5 rounded border-gray-300 text-black focus:ring-0 dark:border-neutral-700 dark:bg-neutral-900"
            :disabled="summary.toUpdate === 0"
            data-testid="restore-data"
          >
          <span>
            {{ TEXT.restoreData(summary.toUpdate) }}
            <span
              v-if="summary.mergedNotes > 0"
              class="block text-gray-400 dark:text-neutral-500"
            >{{ TEXT.mergedHint(summary.mergedNotes) }}</span>
          </span>
        </label>
        <label
          for="backup-recreate-missing"
          class="flex items-start gap-2"
          :class="summary.toCreate === 0 ? 'opacity-50' : 'cursor-pointer'"
        >
          <input
            id="backup-recreate-missing"
            v-model="recreateMissing"
            type="checkbox"
            class="mt-0.5 size-3.5 rounded border-gray-300 text-black focus:ring-0 dark:border-neutral-700 dark:bg-neutral-900"
            :disabled="summary.toCreate === 0"
            data-testid="recreate-missing"
          >
          <span>
            {{ TEXT.recreate(summary.toCreate, folderTitle) }}
            <span class="block text-gray-400 dark:text-neutral-500">{{ TEXT.recreateHint }}</span>
          </span>
        </label>
        <p
          v-if="prepared.skipped.count > 0"
          class="text-gray-400 dark:text-neutral-500"
        >
          {{ TEXT.skipped(prepared.skipped.count) }}
        </p>
        <div class="flex gap-2">
          <AppButton
            class="flex-1 disabled:cursor-not-allowed disabled:opacity-60"
            :title="TEXT.restore"
            :aria-label="TEXT.restore"
            :disabled="!canRestore"
            data-testid="restore-start"
            @click="handleRestore"
          >
            {{ TEXT.restore }}
          </AppButton>
          <AppButton
            variant="gray"
            class="flex-1"
            :title="TEXT.cancel"
            :aria-label="TEXT.cancel"
            @click="reset"
          >
            {{ TEXT.cancel }}
          </AppButton>
        </div>
      </div>

      <div
        v-else-if="step === 'running'"
        class="mt-2 flex flex-col gap-2 text-xs text-gray-500 dark:text-neutral-400"
      >
        <p>{{ TEXT.restoring }}</p>
        <AppProgress :progress="progress" />
      </div>

      <div
        v-else-if="step === 'done'"
        class="mt-2 flex flex-col gap-1 rounded-md border border-gray-200 p-3 text-xs text-gray-700 dark:border-neutral-800 dark:text-neutral-300"
        data-testid="restore-report"
      >
        <p
          v-for="line in reportLines"
          :key="line"
        >
          {{ line }}
        </p>
        <ul
          v-if="report.failed.length > 0"
          class="mt-1 list-disc pl-4 text-red-600 dark:text-red-400"
        >
          <li
            v-for="item in report.failed.slice(0, MAX_FAILURES_SHOWN)"
            :key="`${item.url}\u0000${item.title}\u0000${item.reason}`"
            class="break-all"
          >
            {{ item.title || item.url }}: {{ item.reason }}
          </li>
        </ul>
        <AppButton
          variant="gray"
          class="mt-2"
          :title="TEXT.done"
          :aria-label="TEXT.done"
          @click="reset"
        >
          {{ TEXT.done }}
        </AppButton>
      </div>
    </section>
  </div>
</template>

<script setup>
import {
  computed, onMounted, ref, useTemplateRef,
} from 'vue';
import { notify } from 'notiwind';
import AppButton from '@/components/app/AppButton.vue';
import AppProgress from '@/components/app/AppProgress.vue';
import BookmarkStorage from '@/storage/bookmark';
import exportBackup, { exportHtml } from '@/backup/export';
import { prepareRestore, runRestore, READ_FAILED } from '@/backup/restore';
import { restoreFolderTitle } from '@/backup/apply';
import { ERROR } from '@/backup/validate';
import { estimateScreenshotBytes, formatBytes } from '@/backup/format';
import { formatLastBackup } from '@/backup/reminder';
import { NOTIFICATION_DURATION } from '@/constants/app';

const MAX_FAILURES_SHOWN = 5;
const count = (value) => value.toLocaleString('en-US');
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

// Kept in one place to ease adding translations later
const TEXT = {
  backupLabel: 'Backup',
  backupDescription: 'Save bookmarks, tags, notes and pins to a file. Notes and pins are not synced by your browser.',
  lastBackup: 'Last backup:',
  includeScreenshots: 'Include screenshots',
  about: 'about',
  exportJson: 'Export backup',
  exportHtml: 'Export HTML',
  exportHtmlHint: 'Bookmarks file any browser can import (no pins or screenshots)',
  exporting: 'Exporting…',
  exported: (s) => `Backup saved: ${plural(s.bookmarks, 'bookmark')}, ${plural(s.notes, 'note')}, ${count(s.pinned)} pinned.`,
  exportedHtml: (s) => `Bookmarks file saved: ${plural(s.bookmarks, 'bookmark')}.`,
  exportFailed: 'Export failed. Please try again.',
  restoreLabel: 'Restore',
  restoreDescription: 'Bring back notes, pins and missing bookmarks from a backup file. Existing bookmarks are never changed or removed.',
  chooseFile: 'Choose backup file…',
  reading: 'Reading…',
  previewHeading: (date, matched) => `${date ? `Backup from ${date}. ` : ''}${plural(matched, 'bookmark')} found in this browser.`,
  restoreData: (n) => `Restore notes, pins and screenshots for ${plural(n, 'bookmark')}`,
  mergedHint: (n) => `${plural(n, 'note')} will be added below the current notes`,
  recreate: (n, folder) => `Recreate ${plural(n, 'missing bookmark')} in "${folder}"`,
  recreateHint: 'Recreated bookmarks sync to all your devices.',
  skipped: (n) => `${plural(n, 'entry')} skipped (unsupported or invalid links).`,
  restore: 'Restore',
  cancel: 'Cancel',
  restoring: 'Restoring…',
  reportData: (n, merged) => `Restored data for ${plural(n, 'bookmark')}${merged ? ` (${plural(merged, 'note')} merged)` : ''}.`,
  reportRecreated: (n, folder) => `Recreated ${plural(n, 'bookmark')} in "${folder}".`,
  reportNothing: 'Nothing needed to be restored.',
  reportFailed: (n) => `${plural(n, 'item')} could not be restored:`,
  done: 'Done',
  errors: {
    [ERROR.TOO_LARGE]: 'This file is too large to be a FavBox backup.',
    [ERROR.INVALID_JSON]: 'This file is not a FavBox backup (it is not valid JSON).',
    [ERROR.INVALID_FORMAT]: 'This file is not a valid FavBox backup.',
    [ERROR.NOT_A_BACKUP]: 'This file is not a FavBox backup.',
    [ERROR.UNSUPPORTED_VERSION]: 'This backup was made by a different version of FavBox and cannot be restored.',
    [ERROR.TOO_DEEP]: 'This backup has too many nested folders to restore.',
    [ERROR.TOO_MANY_NODES]: 'This backup has too many bookmarks to restore.',
    [READ_FAILED]: 'The file could not be read.',
    unexpected: 'Something went wrong. Please try again.',
  },
};

const fileInputRef = useTemplateRef('fileInput');

const lastBackupAt = ref(null);
const screenshotBytes = ref(0);
const includeScreenshots = ref(true);
const exporting = ref(null);

const step = ref('idle');
const errorMessage = ref('');
const prepared = ref(null);
const restoreData = ref(true);
const recreateMissing = ref(false);
const folderTitle = ref('');
const progress = ref(0);
const report = ref(null);

const isBusy = computed(() => exporting.value !== null || step.value === 'preparing' || step.value === 'running');
const lastBackupText = computed(() => formatLastBackup(lastBackupAt.value, Date.now()));
const summary = computed(() => prepared.value?.plan.summary);
const previewHeading = computed(() => {
  const { exportedAt } = prepared.value;
  const date = exportedAt ? new Date(exportedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null;
  return TEXT.previewHeading(date, summary.value.matched);
});
const canRestore = computed(() => (restoreData.value && summary.value.toUpdate > 0)
  || (recreateMissing.value && summary.value.toCreate > 0));
const reportLines = computed(() => {
  const {
    updated, merged, created, recreated, failed,
  } = report.value;
  const lines = [];
  if (updated + created > 0) lines.push(TEXT.reportData(updated + created, merged));
  if (recreated > 0) lines.push(TEXT.reportRecreated(recreated, report.value.folderTitle));
  if (lines.length === 0 && failed.length === 0) lines.push(TEXT.reportNothing);
  if (failed.length > 0) lines.push(TEXT.reportFailed(failed.length));
  return lines;
});

const handleExport = async (kind) => {
  if (isBusy.value) return;
  exporting.value = kind;
  try {
    if (kind === 'json') {
      const result = await exportBackup({ includeScreenshots: includeScreenshots.value });
      lastBackupAt.value = Date.now();
      notify({ group: 'default', text: TEXT.exported(result) }, NOTIFICATION_DURATION);
    } else {
      const result = await exportHtml();
      notify({ group: 'default', text: TEXT.exportedHtml(result) }, NOTIFICATION_DURATION);
    }
  } catch (e) {
    console.error('Export failed', e);
    notify({ group: 'error', text: TEXT.exportFailed }, NOTIFICATION_DURATION);
  } finally {
    exporting.value = null;
  }
};

const reset = () => {
  step.value = 'idle';
  prepared.value = null;
  report.value = null;
  progress.value = 0;
};

const handleFile = async (event) => {
  const [file] = event.target.files;
  // Allow choosing the same file again
  event.target.value = '';
  if (!file) return;
  errorMessage.value = '';
  step.value = 'preparing';
  try {
    const result = await prepareRestore(file);
    if (result.error) {
      errorMessage.value = TEXT.errors[result.error.code] ?? TEXT.errors.unexpected;
      step.value = 'idle';
      return;
    }
    prepared.value = result;
    restoreData.value = result.plan.summary.toUpdate > 0;
    recreateMissing.value = false;
    folderTitle.value = restoreFolderTitle(new Date());
    step.value = 'preview';
  } catch (e) {
    console.error('Failed to prepare restore', e);
    errorMessage.value = TEXT.errors.unexpected;
    step.value = 'idle';
  }
};

const handleRestore = async () => {
  if (!canRestore.value) return;
  step.value = 'running';
  progress.value = 0;
  try {
    report.value = await runRestore(prepared.value.plan, {
      restoreData: restoreData.value,
      recreateMissing: recreateMissing.value,
      folderTitle: folderTitle.value,
      onProgress: ({ done, total }) => { progress.value = Math.round((done / total) * 100); },
    });
    step.value = 'done';
  } catch (e) {
    console.error('Restore failed', e);
    errorMessage.value = TEXT.errors.unexpected;
    reset();
  }
};

onMounted(async () => {
  try {
    const [stored, rows] = await Promise.all([
      browser.storage.local.get('lastBackupAt'),
      new BookmarkStorage().findAll(),
    ]);
    lastBackupAt.value = stored.lastBackupAt ?? null;
    screenshotBytes.value = estimateScreenshotBytes(rows);
  } catch (e) {
    // Only informational; exporting still works
    console.error('Failed to load backup info', e);
  }
});
</script>
