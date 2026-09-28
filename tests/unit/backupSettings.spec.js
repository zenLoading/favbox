import { describe, expect, it } from 'vitest';
import { SETTINGS_KEYS, readSettings } from '@/backup/settings';

const createStorage = (entries) => ({
  getItem: (key) => (key in entries ? entries[key] : null),
});

describe('readSettings', () => {
  it('reads every known setting', () => {
    const storage = createStorage({
      fontSize: 'lg',
      viewMode: 'list',
      skipBookmarkDeleteConfirmation: 'true',
      'vueuse-color-scheme': 'dark',
    });

    expect(readSettings(storage)).toEqual({
      fontSize: 'lg',
      viewMode: 'list',
      skipDeleteConfirmation: true,
      theme: 'dark',
    });
  });

  it('parses the stored boolean', () => {
    expect(readSettings(createStorage({ skipBookmarkDeleteConfirmation: 'false' })))
      .toEqual({ skipDeleteConfirmation: false });
  });

  it('leaves out settings that were never changed', () => {
    expect(readSettings(createStorage({}))).toEqual({});
  });

  it('returns an empty object when storage is not accessible', () => {
    const storage = { getItem: () => { throw new Error('SecurityError'); } };

    expect(readSettings(storage)).toEqual({});
  });

  it('uses the keys the app writes to', () => {
    expect(SETTINGS_KEYS).toEqual({
      fontSize: 'fontSize',
      viewMode: 'viewMode',
      skipDeleteConfirmation: 'skipBookmarkDeleteConfirmation',
      theme: 'vueuse-color-scheme',
    });
  });
});
