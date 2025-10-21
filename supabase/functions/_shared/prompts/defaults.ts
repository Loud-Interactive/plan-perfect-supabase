// Default prompt templates for content generation
// These serve as fallbacks when prompts aren't defined in pairs table or synopsis

export const PROMPT_MAP: Record<string, string> = {
  // Research stage prompts
  research_prompt: `Research the topic thoroughly using web search. Find authoritative sources, key facts, and important perspectives.`,
  
  // Outline stage prompts
  outline_prompt: `Create a comprehensive, well-structured outline for the article. Include main sections (H2) and subsections (H3).`,
  
  // Draft stage prompts
  draft_prompt: `Write a complete, engaging article based on the outline and research. Use a professional yet accessible tone.`,
  
  // QA stage prompts
  qa_prompt: `Review the content for accuracy, clarity, SEO optimization, and brand alignment. Suggest improvements.`,
  
  // Export stage prompts
  export_prompt: `Format the content for publication. Ensure proper HTML structure and metadata.`,
  
  // General fallback
  default_prompt: `Process this content according to the stage requirements.`,
}

// Note: Specific prompts should be defined in the pairs table per domain
// This file provides minimal fallbacks only

