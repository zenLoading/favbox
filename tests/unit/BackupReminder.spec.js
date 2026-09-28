import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import browser from 'webextension-polyfill';
import { notify } from 'notiwind';
import exportBackup from '@/backup/export';
import BackupReminder from '@/ext/browser/components/BackupReminder.vue';

const DAY = 24 * 60 * 60 * 1000;
const mocks = vi.hoisted(() => ({ findPinned: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: { storage: { local: { get: vi.fn(), set: vi.fn() } } },
}));
// BackupReminder instantiates BookmarkStorage with `new`, so the mock must be a regular function
vi.mock('@/storage/bookmark', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function BookmarkStorage() { return { findPinned: mocks.findPinned }; }),
}));
vi.mock('notiwind', () => ({ notify: vi.fn() }));
vi.mock('@/backup/export', () => ({ default: vi.fn() }));

const mountReminder = async () => {
  const wrapper = mount(BackupReminder);
  await flushPromises();
  return wrapper;
};
const reminder = (wrapper) => wrapper.find('[data-testid="backup-reminder"]');
const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text() === text);

describe('BackupReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue();
    mocks.findPinned.mockResolvedValue([{ id: '1' }]);
    vi.mocked(exportBackup).mockResolvedValue({
      bookmarks: 10, folders: 1, notes: 2, pinned: 1, screenshots: 0,
    });
  });

  it('asks users with pinned bookmarks who never backed up', async () => {
    const wrapper = await mountReminder();

    expect(reminder(wrapper).exists()).toBe(true);
    expect(reminder(wrapper).text()).toContain('only stored in this browser');
    expect(mocks.findPinned).toHaveBeenCalledWith(0, 1);
  });

  it('mentions how old the last backup is', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ lastBackupAt: Date.now() - 45 * DAY });

    const wrapper = await mountReminder();

    expect(reminder(wrapper).text()).toContain('Your last backup was 45 days ago.');
  });

  it('stays hidden without pinned bookmarks or with a recent backup', async () => {
    mocks.findPinned.mockResolvedValue([]);
    expect(reminder(await mountReminder()).exists()).toBe(false);

    mocks.findPinned.mockResolvedValue([{ id: '1' }]);
    vi.mocked(browser.storage.local.get).mockResolvedValue({ lastBackupAt: Date.now() - DAY });
    expect(reminder(await mountReminder()).exists()).toBe(false);
  });

  it('stays hidden after being dismissed recently', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ backupReminderDismissedAt: Date.now() - DAY });

    expect(reminder(await mountReminder()).exists()).toBe(false);
  });

  it('backs up and hides', async () => {
    const wrapper = await mountReminder();

    await button(wrapper, 'Back up now').trigger('click');
    await flushPromises();

    expect(exportBackup).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ group: 'default' }), expect.any(Number));
    expect(reminder(wrapper).exists()).toBe(false);
  });

  it('stays visible and reports the error when the backup fails', async () => {
    vi.mocked(exportBackup).mockRejectedValue(new Error('IDB closed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await mountReminder();

    await button(wrapper, 'Back up now').trigger('click');
    await flushPromises();

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ group: 'error' }), expect.any(Number));
    expect(reminder(wrapper).exists()).toBe(true);
  });

  it('remembers when it was dismissed', async () => {
    const wrapper = await mountReminder();

    await button(wrapper, 'Not now').trigger('click');
    await flushPromises();

    expect(browser.storage.local.set).toHaveBeenCalledWith({ backupReminderDismissedAt: expect.any(Number) });
    expect(reminder(wrapper).exists()).toBe(false);
  });

  it('stays hidden when its data cannot be loaded', async () => {
    mocks.findPinned.mockRejectedValue(new Error('IDB closed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(reminder(await mountReminder()).exists()).toBe(false);
  });
});
