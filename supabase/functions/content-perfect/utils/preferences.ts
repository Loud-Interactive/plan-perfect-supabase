// Content Perfect Preferences Utilities
// Provides functions for fetching and using domain preferences from pairs table

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Normalizes a domain by removing protocol, www prefix, and trailing slash
 * @param domain Domain to normalize
 * @returns Normalized domain
 */
export const normalizeDomain = (domain: string): string => {
  return domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
};

/**
 * Converts string "true"/"false" to boolean values
 * @param value Input value
 * @returns Converted value
 */
export const stringToBool = (value: any): any => {
  if (value === null || value === undefined) return value;
  
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  
  return value;
};

/**
 * Fetches domain preferences from the pairs table
 * @param supabase SupabaseClient instance
 * @param domain Domain to fetch preferences for
 * @returns Object with key-value pairs
 */
export const getDomainPreferences = async (
  supabase: SupabaseClient,
  domain: string
): Promise<Record<string, any>> => {
  try {
    // Normalize domain
    const normalizedDomain = normalizeDomain(domain);
    
    // Fetch all preferences for the domain
    const { data, error } = await supabase
      .from('pairs')
      .select('key, value')
      .eq('domain', normalizedDomain);
    
    if (error) {
      console.error('Error fetching domain preferences:', error.message);
      return {};
    }
    
    if (!data || data.length === 0) {
      console.warn(`No preferences found for domain: ${normalizedDomain}`);
      return {};
    }
    
    // Convert to key-value object
    const preferences: Record<string, any> = {};
    
    for (const pair of data) {
      preferences[pair.key] = stringToBool(pair.value);
    }
    
    return preferences;
  } catch (error) {
    console.error('Exception when fetching domain preferences:', error);
    return {};
  }
};

/**
 * Gets the style settings for a domain
 * @param preferences Domain preferences
 * @returns Style settings object
 */
export const getStyleSettings = (preferences: Record<string, any>): Record<string, any> => {
  const styleSettings: Record<string, any> = {};
  
  // Extract style-related preferences
  const stylePrefixes = ['style_', 'font_', 'color_', 'Post_Style', 'post_style_tag_main'];
  
  for (const [key, value] of Object.entries(preferences)) {
    if (stylePrefixes.some(prefix => key.startsWith(prefix)) || key === 'Post_Style' || key === 'post_style_tag_main') {
      styleSettings[key] = value;
    }
  }
  
  return styleSettings;
};

/**
 * Gets the schema settings for a domain
 * @param preferences Domain preferences
 * @returns Schema settings object
 */
export const getSchemaSettings = (preferences: Record<string, any>): Record<string, any> => {
  const schemaSettings: Record<string, any> = {};
  
  // Extract schema-related preferences
  const schemaPrefixes = ['schema_', 'json_ld_', 'JSON_LD_'];
  
  for (const [key, value] of Object.entries(preferences)) {
    if (schemaPrefixes.some(prefix => key.startsWith(prefix))) {
      schemaSettings[key] = value;
    }
  }
  
  return schemaSettings;
};

/**
 * Gets the content generation settings for a domain
 * @param preferences Domain preferences
 * @returns Content generation settings object
 */
export const getContentSettings = (preferences: Record<string, any>): Record<string, any> => {
  const contentSettings: Record<string, any> = {};
  
  // Extract content-related preferences
  const contentKeys = [
    'synopsis', 
    'tone', 
    'content_format',
    'writing_style',
    'audience',
    'content_length',
    'include_citations',
    'include_images',
    'enable_conclusion',
    'enable_intro',
    'enable_toc'
  ];
  
  for (const key of contentKeys) {
    if (key in preferences) {
      contentSettings[key] = preferences[key];
    }
  }
  
  return contentSettings;
};

/**
 * Creates a client synopsis object from domain preferences
 * @param preferences Domain preferences
 * @returns Client synopsis object
 */
export const createClientSynopsis = (preferences: Record<string, any>): Record<string, any> => {
  const synopsis: Record<string, any> = {};
  
  // Include all preferences in synopsis
  Object.assign(synopsis, preferences);
  
  // Set default values if not present
  synopsis.synopsis = synopsis.synopsis || '';
  synopsis.tone = synopsis.tone || 'professional';
  synopsis.writing_style = synopsis.writing_style || 'clear and concise';
  synopsis.audience = synopsis.audience || 'general';
  synopsis.include_citations = typeof synopsis.include_citations !== 'undefined' ? synopsis.include_citations : true;
  synopsis.enable_conclusion = typeof synopsis.enable_conclusion !== 'undefined' ? synopsis.enable_conclusion : true;
  synopsis.enable_intro = typeof synopsis.enable_intro !== 'undefined' ? synopsis.enable_intro : true;
  
  return synopsis;
};