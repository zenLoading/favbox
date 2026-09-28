import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import downloadText from '@/backup/download';

// jsdom's Blob has no text()
const readBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

describe('downloadText', () => {
  let clicked;

  beforeEach(() => {
    vi.useFakeTimers();
    clicked = [];
    URL.createObjectURL = vi.fn(() => 'blob:favbox/1');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download, isConnected: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('downloads the text as a file with the given name', async () => {
    downloadText('{"a":1}', 'favbox-backup.json');

    expect(clicked).toEqual([{ href: 'blob:favbox/1', download: 'favbox-backup.json', isConnected: true }]);
    const [blob] = URL.createObjectURL.mock.calls[0];
    expect(blob.type).toBe('application/json');
    // FileReader relies on timers, which are faked in this file
    vi.useRealTimers();
    expect(await readBlob(blob)).toBe('{"a":1}');
  });

  it('removes the link and releases the blob url afterwards', () => {
    downloadText('x', 'a.json');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:favbox/1');
  });

  it('uses the given mime type', () => {
    downloadText('<html></html>', 'bookmarks.html', 'text/html');

    const [blob] = URL.createObjectURL.mock.calls[0];
    expect(blob.type).toBe('text/html');
  });
});
