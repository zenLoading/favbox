// Backup field name -> localStorage key written by the app (useStorage / useColorMode)
export const SETTINGS_KEYS = {
  fontSize: 'fontSize',
  viewMode: 'viewMode',
  skipDeleteConfirmation: 'skipBookmarkDeleteConfirmation',
  theme: 'vueuse-color-scheme',
};

const BOOLEAN_SETTINGS = new Set(['skipDeleteConfirmation']);

/**
 * Reads the user settings that were changed from their defaults.
 * @param {Storage} storage - Usually window.localStorage.
 * @returns {object} Settings keyed by backup field name.
 */
export function readSettings(storage) {
  try {
    return Object.fromEntries(
      Object.entries(SETTINGS_KEYS)
        .map(([field, key]) => [field, storage.getItem(key)])
        .filter(([, value]) => value !== null)
        .map(([field, value]) => [field, BOOLEAN_SETTINGS.has(field) ? value === 'true' : value]),
    );
  } catch (e) {
    console.error('Settings are not accessible', e);
    return {};
  }
}
