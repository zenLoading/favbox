import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isProxy } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import browser from 'webextension-polyfill';
import { notify } from 'notiwind';
import exportBackup, { exportHtml } from '@/backup/export';
import { prepareRestore, runRestore } from '@/backup/restore';
import BackupPanel from '@/ext/browser/components/BackupPanel.vue';

const mocks = vi.hoisted(() => ({ findAll: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: vi.fn() } } },
}));
// BackupPanel instantiates BookmarkStorage with `new`, so the mock must be a regular function
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return { findAll: mocks.findAll }; }),
}));
vi.mock('notiwind', () => ({ notify: vi.fn() }));
vi.mock('@/backup/export', () => ({ default: vi.fn(), exportHtml: vi.fn() }));
vi.mock('@/backup/restore', () => ({
  READ_FAILED: 'READ_FAILED',
  prepareRestore: vi.fn(),
  runRestore: vi.fn(),
}));

const summary = (overrides = {}) => ({
  matched: 12, toUpdate: 3, mergedNotes: 1, unchanged: 9, toCreate: 2, ...overrides,
});
const prepared = (overrides = {}) => ({
  error: null,
  exportedAt: '2026-09-01T10:00:00.000Z',
  skipped: { count: 1, items: [] },
  droppedFields: 0,
  plan: { updates: [], creates: [], summary: summary() },
  ...overrides,
});

const mountPanel = async () => {
  const wrapper = mount(BackupPanel);
  await flushPromises();
  return wrapper;
};

const chooseFile = async (wrapper, file = new File(['{}'], 'backup.json')) => {
  const input = wrapper.get('[data-testid="restore-file"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await flushPromises();
};

describe('BackupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    mocks.findAll.mockResolvedValue([{ image: `data:image/jpeg;base64,${'A'.repeat(2048)}` }]);
    vi.mocked(exportBackup).mockResolvedValue({
      bookmarks: 1200, folders: 3, notes: 1, pinned: 2, screenshots: 1,
    });
    vi.mocked(exportHtml).mockResolvedValue({
      bookmarks: 1200, folders: 3, notes: 1, pinned: 2, screenshots: 0,
    });
    vi.mocked(prepareRestore).mockResolvedValue(prepared());
    vi.mocked(runRestore).mockResolvedValue({
      updated: 2, merged: 1, created: 1, recreated: 0, folderTitle: null, failed: [],
    });
  });

  describe('export', () => {
    it('shows when the last backup was made and how large screenshots are', async () => {
      const wrapper = await mountPanel();

      expect(wrapper.get('[data-testid="last-backup"]').text()).toContain('Never');
      expect(wrapper.text()).toContain('(about 2.0 KB)');
    });

    it('exports a JSON backup with or without screenshots', async () => {
      const wrapper = await mountPanel();
      await wrapper.get('[data-testid="include-screenshots"]').setValue(false);

      await wrapper.get('[data-testid="export-json"]').trigger('click');
      await flushPromises();

      expect(exportBackup).toHaveBeenCalledWith({ includeScreenshots: false });
      expect(wrapper.get('[data-testid="last-backup"]').text()).toContain('Today');
      expect(notify).toHaveBeenCalledWith(
        { group: 'default', text: 'Backup saved: 1,200 bookmarks, 1 note, 2 pinned.' },
        expect.any(Number),
      );
    });

    it('exports an HTML bookmarks file without changing the last backup', async () => {
      const wrapper = await mountPanel();

      await wrapper.get('[data-testid="export-html"]').trigger('click');
      await flushPromises();

      expect(exportHtml).toHaveBeenCalled();
      expect(wrapper.get('[data-testid="last-backup"]').text()).toContain('Never');
    });

    it('tells the user when the export fails', async () => {
      vi.mocked(exportBackup).mockRejectedValue(new Error('IDB closed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await mountPanel();

      await wrapper.get('[data-testid="export-json"]').trigger('click');
      await flushPromises();

      expect(notify).toHaveBeenCalledWith({ group: 'error', text: 'Export failed. Please try again.' }, expect.any(Number));
    });
  });

  describe('restore', () => {
    it('explains why a file cannot be restored', async () => {
      vi.mocked(prepareRestore).mockResolvedValue({ error: { code: 'NOT_A_BACKUP' } });
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      expect(wrapper.get('[data-testid="restore-error"]').text()).toBe('This file is not a FavBox backup.');
      expect(wrapper.find('[data-testid="restore-preview"]').exists()).toBe(false);
    });

    it('previews what will be restored before changing anything', async () => {
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      const preview = wrapper.get('[data-testid="restore-preview"]');
      expect(preview.text()).toContain('12 bookmarks found in this browser');
      expect(preview.text()).toContain('Restore notes, pins and screenshots for 3 bookmarks');
      expect(preview.text()).toContain('1 note will be added below the current notes');
      expect(preview.text()).toMatch(/Recreate 2 missing bookmarks in "FavBox restore \d{4}-\d{2}-\d{2}"/);
      expect(preview.text()).toContain('1 entry skipped');
      expect(wrapper.get('[data-testid="restore-data"]').element.checked).toBe(true);
      expect(wrapper.get('[data-testid="recreate-missing"]').element.checked).toBe(false);
      expect(runRestore).not.toHaveBeenCalled();
    });

    it('says so when the backup has nothing new, instead of showing a disabled button', async () => {
      vi.mocked(prepareRestore).mockResolvedValue(prepared({
        skipped: { count: 0, items: [] },
        plan: {
          updates: [],
          creates: [],
          summary: summary({
            matched: 3, toUpdate: 0, mergedNotes: 0, unchanged: 3, toCreate: 0,
          }),
        },
      }));
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      const preview = wrapper.get('[data-testid="restore-preview"]');
      expect(preview.text()).toContain('Nothing to restore: all 3 bookmarks in this backup are already here with the same notes, pins and screenshots.');
      expect(wrapper.find('[data-testid="restore-data"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="recreate-missing"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="restore-start"]').exists()).toBe(false);

      await wrapper.findAll('button').find((b) => b.text() === 'Done').trigger('click');
      expect(wrapper.find('[data-testid="restore-file"]').exists()).toBe(true);
    });

    it('says so when the backup has no bookmarks at all', async () => {
      vi.mocked(prepareRestore).mockResolvedValue(prepared({
        plan: {
          updates: [],
          creates: [],
          summary: summary({
            matched: 0, toUpdate: 0, mergedNotes: 0, unchanged: 0, toCreate: 0,
          }),
        },
      }));
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      expect(wrapper.get('[data-testid="restore-nothing"]').text()).toBe('This backup has no bookmarks to restore.');
    });

    it('disables options that have nothing to do and the button when nothing is selected', async () => {
      vi.mocked(prepareRestore).mockResolvedValue(prepared({
        plan: { updates: [], creates: [], summary: summary({ toUpdate: 0, mergedNotes: 0 }) },
      }));
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      expect(wrapper.get('[data-testid="restore-data"]').element.disabled).toBe(true);
      expect(wrapper.get('[data-testid="restore-start"]').element.disabled).toBe(true);
      await wrapper.get('[data-testid="recreate-missing"]').setValue(true);
      expect(wrapper.get('[data-testid="restore-start"]').element.disabled).toBe(false);
    });

    it('restores with the selected options and shows a report', async () => {
      vi.mocked(runRestore).mockResolvedValue({
        updated: 2,
        merged: 1,
        created: 1,
        recreated: 2,
        folderTitle: 'FavBox restore 2026-09-28',
        failed: [{ title: 'Broken', url: 'https://broken.com/', reason: 'Invalid URL' }],
      });
      const wrapper = await mountPanel();
      await chooseFile(wrapper);
      await wrapper.get('[data-testid="recreate-missing"]').setValue(true);

      await wrapper.get('[data-testid="restore-start"]').trigger('click');
      await flushPromises();

      const [plan, options] = vi.mocked(runRestore).mock.calls[0];
      expect(plan).toEqual(prepared().plan);
      expect(options).toMatchObject({ restoreData: true, recreateMissing: true });
      expect(options.folderTitle).toMatch(/^FavBox restore \d{4}-\d{2}-\d{2}$/);
      const report = wrapper.get('[data-testid="restore-report"]').text();
      expect(report).toContain('Restored data for 3 bookmarks (1 note merged).');
      expect(report).toContain('Recreated 2 bookmarks in "Other bookmarks › FavBox restore 2026-09-28".');
      expect(report).toContain('1 item could not be restored:');
      expect(report).toContain('Broken: Invalid URL');
    });

    it('passes a plain plan to the restore, since the database worker cannot clone Vue proxies', async () => {
      vi.mocked(prepareRestore).mockResolvedValue(prepared({
        plan: {
          updates: [{ id: '1', backupData: { keywords: ['a'] } }],
          creates: [{ folders: ['Bar'], data: { keywords: ['b'] } }],
          summary: summary(),
        },
      }));
      const wrapper = await mountPanel();
      await chooseFile(wrapper);
      await wrapper.get('[data-testid="recreate-missing"]').setValue(true);

      await wrapper.get('[data-testid="restore-start"]').trigger('click');
      await flushPromises();

      const [plan] = vi.mocked(runRestore).mock.calls[0];
      expect(isProxy(plan)).toBe(false);
      expect(isProxy(plan.creates[0].data.keywords)).toBe(false);
      expect(() => structuredClone(plan)).not.toThrow();
    });

    it('tells where recreated bookmarks go', async () => {
      const wrapper = await mountPanel();

      await chooseFile(wrapper);

      expect(wrapper.get('[data-testid="restore-preview"]').text()).toContain('Recreated bookmarks go to "Other bookmarks" and sync to all your devices.');
    });

    it('goes back to the start after cancelling', async () => {
      const wrapper = await mountPanel();
      await chooseFile(wrapper);

      await wrapper.findAll('button').find((b) => b.text() === 'Cancel').trigger('click');

      expect(wrapper.find('[data-testid="restore-preview"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="restore-file"]').exists()).toBe(true);
    });
  });
});
