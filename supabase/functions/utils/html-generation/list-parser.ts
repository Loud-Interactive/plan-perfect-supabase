// List parsing utilities for converting markdown lists to structured data
// Ported from Next.js project for use in Supabase Edge Functions

import { ParsedList } from './types.ts';

/**
 * Parse ordered list from numbered markup
 * Example: "1. **Data Analysis** - Review historical data\n2. **Resource Optimization** - Flexible scheduling"
 */
export function parseOrderedList(markup: string): ParsedList {
  // Add type checking to prevent errors
  if (!markup || typeof markup !== 'string') {
    return {
      content_type: 'ordered_list',
      list_items: []
    };
  }

  const lines = markup.split('\n').filter(line => line.trim());
  const listItems: string[] = [];

  for (const line of lines) {
    // Match patterns like "1. **Title** - Description" or "1. Description"
    const match = line.match(/^\d+\.\s*(.+)$/);
    if (match) {
      listItems.push(match[1].trim());
    }
  }

  return {
    content_type: 'ordered_list',
    list_items: listItems
  };
}

/**
 * Parse unordered list from bullet markup
 * Example: "- Automated scheduling systems\n- Real-time route adjustment capabilities"
 */
export function parseUnorderedList(markup: string): ParsedList {
  // Add type checking to prevent errors
  if (!markup || typeof markup !== 'string') {
    return {
      content_type: 'list',
      list_items: []
    };
  }

  const lines = markup.split('\n').filter(line => line.trim());
  const listItems: string[] = [];

  for (const line of lines) {
    // Match patterns like "- Item" or "• Item" or "* Item"
    const match = line.match(/^[-•*]\s*(.+)$/);
    if (match) {
      listItems.push(match[1].trim());
    }
  }

  return {
    content_type: 'list',
    list_items: listItems
  };
}

/**
 * Auto-detect list type and parse accordingly
 * Returns null if no list pattern is detected
 */
export function parseList(markup: string): ParsedList | null {
  // Add type checking to prevent trim() error
  if (!markup || typeof markup !== 'string') {
    return null;
  }

  const trimmedMarkup = markup.trim();

  // Check for ordered list pattern (starts with number)
  if (/^\d+\.\s/.test(trimmedMarkup)) {
    return parseOrderedList(markup);
  }

  // Check for unordered list pattern (starts with bullet)
  if (/^[-•*]\s/.test(trimmedMarkup)) {
    return parseUnorderedList(markup);
  }

  return null;
}

/**
 * Parse mixed content that may contain both ordered and unordered lists
 * Returns an array of parsed sections
 */
export function parseMixedLists(markup: string): Array<{
  type: 'paragraph' | 'list' | 'ordered_list';
  content: string;
  list_items?: string[];
}> {
  // Add type checking to prevent errors
  if (!markup || typeof markup !== 'string') {
    return [{
      type: 'paragraph',
      content: ''
    }];
  }

  const sections: Array<{
    type: 'paragraph' | 'list' | 'ordered_list';
    content: string;
    list_items?: string[];
  }> = [];

  const lines = markup.split('\n');
  let currentSection = '';
  let currentListType: 'list' | 'ordered_list' | null = null;
  let currentListItems: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      // Empty line - flush current section if any
      if (currentSection.trim()) {
        sections.push({
          type: 'paragraph',
          content: currentSection.trim()
        });
        currentSection = '';
      }
      continue;
    }

    // Check if this line starts a new list
    const isOrderedList = /^\d+\.\s/.test(trimmedLine);
    const isUnorderedList = /^[-•*]\s/.test(trimmedLine);

    if (isOrderedList || isUnorderedList) {
      // Flush any current paragraph content
      if (currentSection.trim()) {
        sections.push({
          type: 'paragraph',
          content: currentSection.trim()
        });
        currentSection = '';
      }

      // Flush any current list if type changes
      if (currentListType && currentListItems.length > 0) {
        sections.push({
          type: currentListType,
          content: '',
          list_items: [...currentListItems]
        });
        currentListItems = [];
      }

      // Start new list
      currentListType = isOrderedList ? 'ordered_list' : 'list';
      const match = trimmedLine.match(/^(?:[-•*]|\d+\.)\s*(.+)$/);
      if (match) {
        currentListItems.push(match[1].trim());
      }
    } else {
      // This is paragraph content
      // Flush any current list
      if (currentListType && currentListItems.length > 0) {
        sections.push({
          type: currentListType,
          content: '',
          list_items: [...currentListItems]
        });
        currentListType = null;
        currentListItems = [];
      }

      // Add to paragraph content
      currentSection += (currentSection ? '\n' : '') + trimmedLine;
    }
  }

  // Flush any remaining content
  if (currentListType && currentListItems.length > 0) {
    sections.push({
      type: currentListType,
      content: '',
      list_items: [...currentListItems]
    });
  } else if (currentSection.trim()) {
    sections.push({
      type: 'paragraph',
      content: currentSection.trim()
    });
  }

  return sections;
}
