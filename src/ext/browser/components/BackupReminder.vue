<template>
  <aside
    v-if="isVisible"
    class="fixed bottom-4 right-4 z-40 w-72 rounded-lg border border-gray-200 bg-white p-4 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
    aria-labelledby="backup-reminder-title"
    data-testid="backup-reminder"
  >
    <h2
      id="backup-reminder-title"
      class="text-sm font-semibold text-black dark:text-white"
    >
      {{ TEXT.title }}
    </h2>
    <p class="mt-1 text-gray-600 dark:text-neutral-400">
      {{ message }}
    </p>
    <div class="mt-3 flex gap-2">
      <AppButton
        class="flex-1 disabled:cursor-wait disabled:opacity-60"
        :title="TEXT.backUp"
        :aria-label="TEXT.backUp"
        :disabled="isExporting"
        @click="backUp"
      >
        {{ isExporting ? TEXT.backingUp : TEXT.backUp }}
      </AppButton>
      <AppButton
        variant="gray"
        class="flex-1"
        :title="TEXT.dismiss"
        :aria-label="TEXT.dismiss"
        :disabled="isExporting"
        @click="dismiss"
      >
        {{ TEXT.dismiss }}
      </AppButton>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { notify } from 'notiwind';
import AppButton from '@/components/app/AppButton.vue';
import BookmarkStorage from '@/storage/bookmark';
import exportBackup from '@/backup/export';
import { shouldRemindBackup, formatLastBackup } from '@/backup/reminder';
import { NOTIFICATION_DURATION } from '@/constants/app';

// Kept in one place to ease adding translations later
const TEXT = {
  title: 'Back up your notes',
  neverBackedUp: 'Your notes and pins are only stored in this browser. Save a backup file to keep them safe.',
  lastBackup: (ago) => `Your last backup was ${ago}. Notes and pins are not synced by your browser.`,
  backUp: 'Back up now',
  backingUp: 'Saving…',
  dismiss: 'Not now',
  saved: 'Backup saved.',
  failed: 'Backup failed. Please try again from Settings.',
};

const isVisible = ref(false);
const isExporting = ref(false);
const lastBackupAt = ref(null);

const message = computed(() => (lastBackupAt.value == null
  ? TEXT.neverBackedUp
  : TEXT.lastBackup(formatLastBackup(lastBackupAt.value, Date.now()).toLowerCase())));

const backUp = async () => {
  isExporting.value = true;
  try {
    await exportBackup();
    notify({ group: 'default', text: TEXT.saved }, NOTIFICATION_DURATION);
    isVisible.value = false;
  } catch (e) {
    console.error('Backup from reminder failed', e);
    notify({ group: 'error', text: TEXT.failed }, NOTIFICATION_DURATION);
  } finally {
    isExporting.value = false;
  }
};

const dismiss = async () => {
  isVisible.value = false;
  try {
    await browser.storage.local.set({ backupReminderDismissedAt: Date.now() });
  } catch (e) {
    console.error('Failed to remember reminder dismissal', e);
  }
};

onMounted(async () => {
  try {
    const [stored, pinned] = await Promise.all([
      browser.storage.local.get(['lastBackupAt', 'backupReminderDismissedAt']),
      new BookmarkStorage().findPinned(0, 1),
    ]);
    lastBackupAt.value = stored.lastBackupAt ?? null;
    isVisible.value = shouldRemindBackup({
      // Notes are written on pinned bookmarks, so pins are a cheap proxy for "has data to lose"
      hasUserData: pinned.length > 0,
      lastBackupAt: lastBackupAt.value,
      dismissedAt: stored.backupReminderDismissedAt ?? null,
      now: Date.now(),
    });
  } catch (e) {
    // A reminder is optional: stay hidden rather than bother the user with an error
    console.error('Failed to check backup reminder', e);
  }
});
</script>
