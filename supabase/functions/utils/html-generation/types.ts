// TypeScript interfaces for HTML generation system
// Ported from Next.js project for use in Supabase Edge Functions

export interface PostContentJSON {
  title: string;
  summary?: {
    content: string;
  };
  hero_image?: {
    url: string;
    alt_text: string;
    caption?: string;
  };
  author?: {
    name: string;
    social_links?: {
      website?: string;
    };
  };
  publish_date?: string;
  read_time?: number;
  company_info?: {
    name: string;
    description: string;
    social_links?: {
      facebook?: string;
      linkedin?: string;
      twitter?: string;
      instagram?: string;
      youtube?: string;
      email?: string;
      phone?: string;
    };
  };
  sections: BlogSection[];
  quote?: {
    text: string;
    author_name: string;
    author_title: string;
    author_company?: string;
  };
  conclusion?: {
    content: string;
    cta_text?: string;
    cta_url?: string;
  };
  key_takeaways?: {
    description: string;
    items: string[];
    cta_text?: string;
    cta_url?: string;
  };
  references: Reference[];
}

export interface BlogSection {
  heading: string;
  subsections: BlogSubsection[];
}

export interface BlogSubsection {
  heading: string;
  content: string;
  content_type?: 'paragraph' | 'list' | 'ordered_list';
  list_items?: string[];
}

export interface Reference {
  url: string;
  citation: string;
}

export interface PreferencesProps {
  // Core company info
  company_name?: string;
  about_company?: string;
  author_name?: string;
  domain?: string;

  // Social media links
  facebook?: string;
  linkedin?: string;
  twitter?: string;
  instagram?: string;
  youtube?: string;
  tiktok?: string;
  pinterest?: string;
  reddit?: string;
  medium?: string;
  github?: string;
  dribbble?: string;
  behance?: string;
  vimeo?: string;
  soundcloud?: string;
  spotify?: string;
  twitch?: string;
  discord?: string;
  telegram?: string;
  whatsapp?: string;
  snapchat?: string;
  tumblr?: string;
  quora?: string;
  email?: string;
  phone?: string;

  // Styling
  social_icon_theme?: 'black' | 'white' | 'full_color';
  post_style_tag_main?: string;

  // Callout configuration
  post_callout_left?: string;
  post_callout_right?: string;
  callout_left_cta_dest_url?: string;
  callout_left_cta_anchor_text?: string;
  callout_right_cta_dest_url?: string;
  callout_right_cta_anchor_text?: string;

  // Key takeaways
  key_takeaways_cta_anchor_text?: string;
  key_takeaways_cta_dest_url?: string;

  // Template settings
  HTML_Post_Template?: string;
  include_conclusion?: boolean;
  quote_wide_text?: string;

  // Schema generation
  jsonLdSchemaPostTemplate?: string;
  jsonLdSchemaGenerationPrompt?: string;
}

export interface CalloutPreferences {
  post_callout_left: string;
  post_callout_right: string;
  callout_left_cta_dest_url: string;
  callout_left_cta_anchor_text: string;
  callout_right_cta_dest_url: string;
  callout_right_cta_anchor_text: string;
  key_takeaways_cta_dest_url: string;
  key_takeaways_cta_anchor_text: string;
  quote_wide_text: string;
  HTML_Post_Template: string;
  include_conclusion: boolean;
}

export interface H2Section {
  heading: string;
  content: string;
  position: number;
  id: string;
}

export interface ParsedList {
  content_type: 'list' | 'ordered_list';
  list_items: string[];
}

export interface OutlineData {
  outline: {
    sections: Array<{
      title: string;
      subheadings?: string[];
    }>;
  };
  content_plan_id?: string; // UUID of the content plan (maps to content_plan_guid in tasks)
  client_name: string;
  client_domain: string;
  brand_voice?: string;
  entity_voice?: string;
  writing_language?: string;
  target_keyword?: string;
  seo_keyword?: string;
  synopsis_and_cta?: string;
}

export interface GenerateMarkupResult {
  markdown: string;
  prompt_used: string;
}

export interface GenerateJsonResult {
  json: PostContentJSON;
  success: boolean;
  error?: string;
}

export interface GenerateHtmlResult {
  html: string;
  success: boolean;
  error?: string;
}

export interface CalloutGenerationResult {
  callouts: Map<string, string>;
  success: boolean;
  error?: string;
}
