// GSC Indexing Types

/**
 * Enum representing indexing status of a URL
 */
export enum IndexingStatus {
  SubmittedAndIndexed = "Submitted and indexed",
  DuplicateWithoutUserSelectedCanonical = "Duplicate without user-selected canonical",
  CrawledCurrentlyNotIndexed = "Crawled - currently not indexed",
  DiscoveredCurrentlyNotIndexed = "Discovered - currently not indexed",
  PageWithRedirect = "Page with redirect",
  URLIsUnknownToGoogle = "URL is unknown to Google",
  RateLimited = "RateLimited",
  Forbidden = "Forbidden",
  Error = "Error"
}

/**
 * Maps status names to emoji representations
 */
export const StatusEmoji: Record<IndexingStatus, string> = {
  [IndexingStatus.SubmittedAndIndexed]: "✅",
  [IndexingStatus.DuplicateWithoutUserSelectedCanonical]: "😵",
  [IndexingStatus.CrawledCurrentlyNotIndexed]: "👀",
  [IndexingStatus.DiscoveredCurrentlyNotIndexed]: "👀",
  [IndexingStatus.PageWithRedirect]: "🔀",
  [IndexingStatus.URLIsUnknownToGoogle]: "❓",
  [IndexingStatus.RateLimited]: "🚦",
  [IndexingStatus.Forbidden]: "🔐",
  [IndexingStatus.Error]: "❌"
};