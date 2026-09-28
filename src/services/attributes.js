/**
 * Rebuilds the attributes table (domains, tags, keywords with counts) from the stored bookmarks.
 * Aggregates first, so the table is empty only between clear and insert.
 * @param {import('@/storage/bookmark').default} bookmarkStorage
 * @param {import('@/storage/attribute').default} attributeStorage
 * @returns {Promise<void>}
 */
export default async function rebuildAttributes(bookmarkStorage, attributeStorage) {
  const [domains, tags, keywords] = await Promise.all([
    bookmarkStorage.aggregateDomains(),
    bookmarkStorage.aggregateTags(),
    bookmarkStorage.aggregateKeywords(),
  ]);
  await attributeStorage.refreshFromAggregated(domains, tags, keywords, true);
}
