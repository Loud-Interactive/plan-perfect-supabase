// Preferences loader - fetches configuration from Supabase pairs table
// Handles all domain-specific settings for HTML generation

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PreferencesProps, CalloutPreferences } from './types.ts';

// Default callout HTML template
const DEFAULT_CALLOUT_TEMPLATE = `
<div class="callout callout_{position} callout_color1">
  <div class="callout_text">{callout_text}</div>
  <div class="callout_cta_button">
    <a href="{cta_url}" target="_blank" rel="noreferrer noopener">
      <span>{cta_text}</span>
      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.07178 7.27418L4.34559 4.00037L1.07178 0.726562M5.65511 7.27418L8.92892 4.00037L5.65511 0.726562" stroke-width="1.30952" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </a>
  </div>
</div>`;

// Default preferences
export const DEFAULT_PREFERENCES: PreferencesProps = {
  company_name: 'About Company',
  about_company: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  author_name: 'Author',
  domain: 'global',
  social_icon_theme: 'full_color',
  callout_left_cta_anchor_text: 'Learn More',
  callout_left_cta_dest_url: '#',
  callout_right_cta_anchor_text: 'Learn More',
  callout_right_cta_dest_url: '#',
  key_takeaways_cta_anchor_text: 'Get Started',
  key_takeaways_cta_dest_url: '#',
  post_style_tag_main: '',
  facebook: '',
  linkedin: '',
  twitter: '',
  instagram: '',
  youtube: '',
  email: '',
  phone: '',
  jsonLdSchemaPostTemplate: '',
  jsonLdSchemaGenerationPrompt: ''
};

// Default callout preferences
export const DEFAULT_CALLOUT_PREFERENCES: CalloutPreferences = {
  post_callout_left: DEFAULT_CALLOUT_TEMPLATE,
  post_callout_right: DEFAULT_CALLOUT_TEMPLATE,
  callout_left_cta_dest_url: '#',
  callout_left_cta_anchor_text: 'Learn More',
  callout_right_cta_dest_url: '#',
  callout_right_cta_anchor_text: 'Learn More',
  key_takeaways_cta_dest_url: '#',
  key_takeaways_cta_anchor_text: 'Get Started',
  quote_wide_text: '',
  HTML_Post_Template: '',
  include_conclusion: true
};

/**
 * Convert pairs array to object with defaults
 */
function pairsArrayToObject<T extends Record<string, any>>(
  pairs: Array<{ key: string; value: any }> | null,
  defaults: T
): T {
  if (!pairs || pairs.length === 0) {
    return { ...defaults };
  }

  const result = { ...defaults };

  for (const pair of pairs) {
    if (pair.key in result) {
      // Handle boolean conversion
      if (pair.key === 'include_conclusion') {
        result[pair.key] = pair.value === true || pair.value === 'true' || pair.value === '1';
      } else {
        result[pair.key] = pair.value;
      }
    }
  }

  return result;
}

/**
 * Load all preferences from pairs table by domain
 */
export async function loadPreferences(
  supabase: SupabaseClient,
  domain: string
): Promise<PreferencesProps> {
  console.log(`[PreferencesLoader] Loading preferences for domain: ${domain}`);

  try {
    const { data, error } = await supabase
      .from('pairs')
      .select('key, value')
      .eq('domain', domain);

    if (error) {
      console.error('[PreferencesLoader] Error fetching preferences:', error);
      return { ...DEFAULT_PREFERENCES, domain };
    }

    if (!data || data.length === 0) {
      console.warn(`[PreferencesLoader] No preferences found for domain: ${domain}, using defaults`);
      return { ...DEFAULT_PREFERENCES, domain };
    }

    console.log(`[PreferencesLoader] Found ${data.length} preference pairs for domain: ${domain}`);

    const preferences = pairsArrayToObject(data, DEFAULT_PREFERENCES);
    preferences.domain = domain; // Ensure domain is set

    return preferences;
  } catch (error) {
    console.error('[PreferencesLoader] Exception loading preferences:', error);
    return { ...DEFAULT_PREFERENCES, domain };
  }
}

/**
 * Load callout-specific preferences from pairs table
 */
export async function loadCalloutPreferences(
  supabase: SupabaseClient,
  domain: string
): Promise<CalloutPreferences> {
  console.log(`[PreferencesLoader] Loading callout preferences for domain: ${domain}`);

  try {
    const { data, error } = await supabase
      .from('pairs')
      .select('key, value')
      .eq('domain', domain)
      .in('key', [
        'post_callout_left',
        'post_callout_right',
        'callout_left_cta_dest_url',
        'callout_left_cta_anchor_text',
        'callout_right_cta_dest_url',
        'callout_right_cta_anchor_text',
        'key_takeaways_cta_dest_url',
        'key_takeaways_cta_anchor_text',
        'quote_wide_text',
        'HTML_Post_Template',
        'include_conclusion'
      ]);

    if (error) {
      console.error('[PreferencesLoader] Error fetching callout preferences:', error);
      return { ...DEFAULT_CALLOUT_PREFERENCES };
    }

    if (!data || data.length === 0) {
      console.warn(`[PreferencesLoader] No callout preferences found for domain: ${domain}, using defaults`);
      return { ...DEFAULT_CALLOUT_PREFERENCES };
    }

    console.log(`[PreferencesLoader] Found ${data.length} callout preference pairs for domain: ${domain}`);

    return pairsArrayToObject(data, DEFAULT_CALLOUT_PREFERENCES);
  } catch (error) {
    console.error('[PreferencesLoader] Exception loading callout preferences:', error);
    return { ...DEFAULT_CALLOUT_PREFERENCES };
  }
}

/**
 * Load complete preferences (regular + callout)
 */
export async function loadCompletePreferences(
  supabase: SupabaseClient,
  domain: string
): Promise<{ preferences: PreferencesProps; calloutPreferences: CalloutPreferences }> {
  // Use a single query to fetch all data at once for efficiency
  console.log(`[PreferencesLoader] Loading complete preferences for domain: ${domain}`);

  try {
    const { data, error } = await supabase
      .from('pairs')
      .select('key, value')
      .eq('domain', domain);

    if (error) {
      console.error('[PreferencesLoader] Error fetching complete preferences:', error);
      return {
        preferences: { ...DEFAULT_PREFERENCES, domain },
        calloutPreferences: { ...DEFAULT_CALLOUT_PREFERENCES }
      };
    }

    if (!data || data.length === 0) {
      console.warn(`[PreferencesLoader] No preferences found for domain: ${domain}, using defaults`);
      return {
        preferences: { ...DEFAULT_PREFERENCES, domain },
        calloutPreferences: { ...DEFAULT_CALLOUT_PREFERENCES }
      };
    }

    console.log(`[PreferencesLoader] Found ${data.length} total preference pairs for domain: ${domain}`);

    // Split into regular preferences and callout preferences
    const preferences = pairsArrayToObject(data, DEFAULT_PREFERENCES);
    preferences.domain = domain;

    const calloutPreferences = pairsArrayToObject(data, DEFAULT_CALLOUT_PREFERENCES);

    return { preferences, calloutPreferences };
  } catch (error) {
    console.error('[PreferencesLoader] Exception loading complete preferences:', error);
    return {
      preferences: { ...DEFAULT_PREFERENCES, domain },
      calloutPreferences: { ...DEFAULT_CALLOUT_PREFERENCES }
    };
  }
}
