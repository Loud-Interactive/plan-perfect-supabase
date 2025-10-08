/**
 * Comprehensive encoding utilities to fix mojibake and character encoding issues
 */

// Comprehensive HTML entity map including all common entities
const HTML_ENTITIES: Record<string, string> = {
  // Basic entities
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  
  // Common typographic entities
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&bull;': '•',
  '&middot;': '·',
  '&deg;': '°',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥',
  '&cent;': '¢',
  '&sect;': '§',
  '&para;': '¶',
  '&dagger;': '†',
  '&Dagger;': '‡',
  '&permil;': '‰',
  '&prime;': '′',
  '&Prime;': '″',
  
  // Arrows
  '&larr;': '←',
  '&rarr;': '→',
  '&uarr;': '↑',
  '&darr;': '↓',
  '&harr;': '↔',
  
  // Math symbols
  '&times;': '×',
  '&divide;': '÷',
  '&minus;': '−',
  '&plusmn;': '±',
  '&ne;': '≠',
  '&le;': '≤',
  '&ge;': '≥',
  '&asymp;': '≈',
  '&infin;': '∞',
  
  // Fractions
  '&frac12;': '½',
  '&frac14;': '¼',
  '&frac34;': '¾',
  
  // Spaces
  '&ensp;': ' ',
  '&emsp;': ' ',
  '&thinsp;': ' ',
  '&zwnj;': '‌',
  '&zwj;': '‍',
};

/**
 * Decode all HTML entities including numeric references
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  
  // First, replace named entities
  let decoded = text;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }
  
  // Then handle numeric entities (decimal)
  decoded = decoded.replace(/&#(\d+);/g, (match, code) => {
    try {
      return String.fromCharCode(parseInt(code, 10));
    } catch {
      return match;
    }
  });
  
  // Handle numeric entities (hexadecimal)
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
    try {
      return String.fromCharCode(parseInt(code, 16));
    } catch {
      return match;
    }
  });
  
  return decoded;
}

/**
 * Fix common mojibake patterns
 */
export function fixMojibake(text: string): string {
  if (!text) return text;
  
  // Common mojibake patterns and their fixes
  const mojibakePatterns: Array<[RegExp, string]> = [
    // UTF-8 replacement character that got re-encoded
    [/ï¿½/g, ''],
    [/�/g, ''],
    [/\ufffd/g, ''], // Unicode replacement character
    
    // Windows-1252 smart quotes misinterpreted as UTF-8
    [/â€œ/g, '"'],
    [/â€/g, '"'],
    [/â€™/g, "'"],
    [/â€˜/g, "'"],
    [/â€"/g, '—'],
    [/â€"/g, '–'],
    [/â€¦/g, '…'],
    
    // Common double-encoding patterns
    [/Ã¢â‚¬â„¢/g, "'"],
    [/Ã¢â‚¬/g, '"'],
    [/Ã¢â‚¬Å"/g, '"'],
    [/Ã¢â‚¬â€œ/g, '–'],
    [/Ã¢â‚¬â€/g, '—'],
    [/Ã‚Â/g, ''],
    
    // Latin-1 to UTF-8 conversion errors
    [/Ã©/g, 'é'],
    [/Ã¨/g, 'è'],
    [/Ã /g, 'à'],
    [/Ã§/g, 'ç'],
    [/Ã±/g, 'ñ'],
    [/Ã¼/g, 'ü'],
    [/Ã¶/g, 'ö'],
    [/Ã¤/g, 'ä'],
    
    // Clean up multiple spaces
    [/\s+/g, ' '],
  ];
  
  let fixed = text;
  for (const [pattern, replacement] of mojibakePatterns) {
    fixed = fixed.replace(pattern, replacement);
  }
  
  return fixed;
}

/**
 * Normalize Unicode characters for consistent storage
 */
export function normalizeUnicode(text: string): string {
  if (!text) return text;
  
  // Map of Unicode characters to their ASCII equivalents
  const unicodeMap: Record<string, string> = {
    // Smart quotes
    '\u2018': "'", // Left single quotation mark
    '\u2019': "'", // Right single quotation mark
    '\u201C': '"', // Left double quotation mark
    '\u201D': '"', // Right double quotation mark
    
    // Dashes
    '\u2013': '-',  // En dash
    '\u2014': '--', // Em dash
    '\u2212': '-',  // Minus sign
    
    // Ellipsis
    '\u2026': '...',
    
    // Spaces
    '\u00A0': ' ', // non-breaking space
    '\u2002': ' ', // en space
    '\u2003': ' ', // em space
    '\u2009': ' ', // thin space
    '\u200B': '', // zero-width space
    '\u200C': '', // zero-width non-joiner
    '\u200D': '', // zero-width joiner
    
    // Other common substitutions
    '\u2022': '*',     // Bullet
    '\u00B7': '*',     // Middle dot
    '\u00B0': ' degrees',
    '\u2122': '(TM)',
    '\u00AE': '(R)',
    '\u00A9': '(C)',
    '\u00D7': 'x',
    '\u00F7': '/',
    '\u00B1': '+/-',
  };
  
  let normalized = text;
  for (const [unicode, ascii] of Object.entries(unicodeMap)) {
    normalized = normalized.replace(new RegExp(unicode, 'g'), ascii);
  }
  
  // Normalize Unicode NFC (Canonical Decomposition)
  normalized = normalized.normalize('NFC');
  
  return normalized;
}

/**
 * Clean and fix text encoding issues
 */
export function cleanText(text: string, options?: {
  decodeEntities?: boolean;
  fixMojibake?: boolean;
  normalizeUnicode?: boolean;
  removeReplacementChars?: boolean;
}): string {
  if (!text) return text;
  
  const opts = {
    decodeEntities: true,
    fixMojibake: true,
    normalizeUnicode: true,
    removeReplacementChars: true,
    ...options
  };
  
  let cleaned = text;
  
  // Step 1: Decode HTML entities
  if (opts.decodeEntities) {
    cleaned = decodeHtmlEntities(cleaned);
  }
  
  // Step 2: Fix mojibake patterns
  if (opts.fixMojibake) {
    cleaned = fixMojibake(cleaned);
  }
  
  // Step 3: Normalize Unicode
  if (opts.normalizeUnicode) {
    cleaned = normalizeUnicode(cleaned);
  }
  
  // Step 4: Remove replacement characters
  if (opts.removeReplacementChars) {
    // Remove various forms of replacement characters
    cleaned = cleaned.replace(/[\uFFFD\ufffd]/g, ''); // Unicode replacement
    cleaned = cleaned.replace(/\?{2,}/g, ''); // Multiple question marks
    cleaned = cleaned.replace(/[^\x00-\x7F](?=[^\x00-\x7F]*\?)/g, ''); // Non-ASCII followed by ?
  }
  
  // Final cleanup
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/\s+/g, ' '); // Normalize whitespace
  
  return cleaned;
}

/**
 * Detect probable character encoding from content
 */
export function detectEncoding(content: string | Buffer): string {
  if (typeof content === 'string') {
    content = Buffer.from(content);
  }
  
  // Check for BOM (Byte Order Mark)
  if (content.length >= 3) {
    if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) {
      return 'utf-8';
    }
    if (content[0] === 0xFF && content[1] === 0xFE) {
      return 'utf-16le';
    }
    if (content[0] === 0xFE && content[1] === 0xFF) {
      return 'utf-16be';
    }
  }
  
  // Try to detect based on byte patterns
  const text = content.toString('utf-8');
  
  // Count replacement characters - high count suggests wrong encoding
  const replacementCount = (text.match(/�/g) || []).length;
  const textLength = text.length;
  
  if (replacementCount > textLength * 0.01) {
    // More than 1% replacement chars suggests wrong encoding
    // Try Windows-1252 (common for web content)
    return 'windows-1252';
  }
  
  return 'utf-8';
}

/**
 * Convert text from detected encoding to UTF-8
 */
export function ensureUtf8(input: string | Buffer, sourceEncoding?: string): string {
  if (typeof input === 'string') {
    // Already a string, just clean it
    return cleanText(input);
  }
  
  // Detect encoding if not provided
  const encoding = sourceEncoding || detectEncoding(input);
  
  try {
    // Convert to string using detected encoding
    let text: string;
    if (encoding === 'windows-1252' || encoding === 'latin1') {
      text = input.toString('latin1');
    } else if (encoding === 'utf-16le' || encoding === 'utf-16be') {
      text = input.toString(encoding as BufferEncoding);
    } else {
      text = input.toString('utf-8');
    }
    
    // Clean the text
    return cleanText(text);
  } catch (error) {
    console.error('Encoding conversion error:', error);
    // Fallback: try to decode as UTF-8 and clean
    return cleanText(input.toString('utf-8'));
  }
}

/**
 * Process HTML content with proper encoding handling
 */
export function processHtmlContent(html: string, detectedCharset?: string): string {
  // First, ensure UTF-8
  let processed = html;
  
  // If we have a detected charset that's not UTF-8, try to fix it
  if (detectedCharset && detectedCharset.toLowerCase() !== 'utf-8') {
    // The HTML is already a string, so it's been decoded somehow
    // We need to fix any encoding issues
    processed = fixMojibake(processed);
  }
  
  // Decode all HTML entities
  processed = decodeHtmlEntities(processed);
  
  // Clean up any remaining encoding issues
  processed = cleanText(processed);
  
  return processed;
}