// Keep the blob url alive long enough for the browser to start the download
const REVOKE_DELAY_MS = 1000;

/**
 * Saves text as a file through a temporary link, so no downloads permission is needed.
 * @param {string} content
 * @param {string} fileName
 * @param {string} [type]
 */
export default function downloadText(content, fileName, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}
