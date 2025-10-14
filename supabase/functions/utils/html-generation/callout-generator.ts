// Callout generator - uses Groq Kimi-k2 to generate callout text for H2 sections
// Generates compelling one-sentence summaries for each section

import { H2Section, CalloutGenerationResult, PostContentJSON } from './types.ts';

// Import Groq logging utility from existing utils
// This provides automatic logging and token tracking
const { callGroqWithLogging } = await import('../groq-logging.ts');

/**
 * Extract H2 sections from PostContentJSON
 * Returns sections with their content for callout generation
 */
export function extractH2Sections(json: PostContentJSON): H2Section[] {
  const h2Sections: H2Section[] = [];

  // Special sections to exclude (no callouts in these)
  const excludedSections = ['summary', 'toc', 'key-takeaways', 'key takeaways', 'references', 'conclusion'];

  json.sections.forEach((section, index) => {
    // Skip excluded sections
    if (excludedSections.some(excluded =>
      section.heading.toLowerCase().includes(excluded)
    )) {
      console.log(`[CalloutGenerator] Skipping excluded section: ${section.heading}`);
      return;
    }

    // Combine all subsection content for context
    let sectionContent = '';
    if (section.subsections && section.subsections.length > 0) {
      sectionContent = section.subsections
        .map(sub => {
          if (sub.list_items && sub.list_items.length > 0) {
            return sub.list_items.join(' ');
          }
          return sub.content || '';
        })
        .join(' ')
        .substring(0, 2000); // Limit to 2000 chars for context
    }

    // Create ID from heading (similar to HTML generation)
    const sectionId = `Section_${index + 1}`;

    h2Sections.push({
      heading: section.heading,
      content: sectionContent,
      position: h2Sections.length, // Count only non-excluded sections
      id: sectionId
    });
  });

  console.log(`[CalloutGenerator] Extracted ${h2Sections.length} H2 sections for callout generation`);

  return h2Sections;
}

/**
 * Generate callout text for a single H2 section using Groq Kimi-k2
 */
async function generateCalloutText(
  section: H2Section,
  groqApiKey: string,
  domain: string
): Promise<{ heading: string; text: string }> {
  const prompt = `Based on this section content, generate ONE compelling sentence that captures its essence.

Section Heading: ${section.heading}
Section Content: ${section.content}

Requirements:
- Single sentence only (can be a statement or question)
- Directly derived from actual content (not hypothetical)
- Do NOT start with: "This section is about", "This section explains", "This section discusses", or "This section outlines"
- Be specific and actionable
- Make it engaging and valuable to the reader

Return ONLY the sentence, nothing else.`;

  try {
    const result = await callGroqWithLogging(
      'generate-callout-text',
      prompt,
      groqApiKey,
      domain,
      {
        modelName: 'moonshotai/kimi-k2-instruct-0905',
        temperature: 0.7,
        maxTokens: 150 // One sentence should be relatively short
      }
    );

    const calloutText = result.response.trim();

    // Validate result
    if (!calloutText || calloutText.length < 10) {
      console.warn(`[CalloutGenerator] Generated callout text too short for section: ${section.heading}`);
      return {
        heading: section.heading,
        text: `Learn more about ${section.heading.toLowerCase()}.`
      };
    }

    // Check for forbidden starts
    const forbiddenStarts = [
      'this section is about',
      'this section explains',
      'this section discusses',
      'this section outlines'
    ];

    const startsWithForbidden = forbiddenStarts.some(start =>
      calloutText.toLowerCase().startsWith(start)
    );

    if (startsWithForbidden) {
      console.warn(`[CalloutGenerator] Generated text starts with forbidden phrase, regenerating...`);
      // Return a fallback
      return {
        heading: section.heading,
        text: calloutText.replace(/^this section (is about|explains|discusses|outlines)\s+/i, '').trim()
      };
    }

    console.log(`[CalloutGenerator] Generated callout for "${section.heading}": ${calloutText.substring(0, 50)}...`);

    return {
      heading: section.heading,
      text: calloutText
    };
  } catch (error) {
    console.error(`[CalloutGenerator] Error generating callout for section "${section.heading}":`, error);
    // Return fallback callout
    return {
      heading: section.heading,
      text: `Discover key insights about ${section.heading.toLowerCase()}.`
    };
  }
}

/**
 * Generate callout texts for all H2 sections in parallel
 */
export async function generateCallouts(
  json: PostContentJSON,
  groqApiKey: string,
  domain: string
): Promise<CalloutGenerationResult> {
  console.log('[CalloutGenerator] Starting callout generation...');

  try {
    // Extract H2 sections
    const h2Sections = extractH2Sections(json);

    if (h2Sections.length === 0) {
      console.warn('[CalloutGenerator] No H2 sections found for callout generation');
      return {
        callouts: new Map(),
        success: true,
        error: 'No sections found for callout generation'
      };
    }

    // Generate callouts in parallel for performance
    console.log(`[CalloutGenerator] Generating ${h2Sections.length} callouts in parallel...`);

    const calloutPromises = h2Sections.map(section =>
      generateCalloutText(section, groqApiKey, domain)
    );

    const calloutResults = await Promise.all(calloutPromises);

    // Convert to Map for easy lookup
    const callouts = new Map<string, string>();
    calloutResults.forEach(result => {
      callouts.set(result.heading, result.text);
    });

    console.log(`[CalloutGenerator] Successfully generated ${callouts.size} callouts`);

    return {
      callouts,
      success: true
    };
  } catch (error) {
    console.error('[CalloutGenerator] Error generating callouts:', error);
    return {
      callouts: new Map(),
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate enhanced summary using Groq Kimi-k2
 */
export async function generateEnhancedSummary(
  json: PostContentJSON,
  groqApiKey: string,
  domain: string
): Promise<string> {
  console.log('[CalloutGenerator] Generating enhanced summary...');

  // Extract key content for summary generation
  const title = json.title;
  const sections = json.sections
    .map(s => s.heading)
    .filter(h => !['summary', 'toc', 'references', 'conclusion'].some(excluded =>
      h.toLowerCase().includes(excluded)
    ))
    .slice(0, 5); // First 5 main sections

  const prompt = `Generate a compelling summary paragraph for this blog post.

Title: ${title}
Main Topics: ${sections.join(', ')}

Requirements:
- Write a full paragraph (4-6 sentences)
- Capture the essence and value of the article
- Be engaging and informative
- Focus on what the reader will learn and why it matters
- Use active voice
- Flow naturally from introduction to key points to value proposition
- Make it comprehensive yet concise

Return ONLY the summary paragraph, nothing else.`;

  try {
    const result = await callGroqWithLogging(
      'generate-enhanced-summary',
      prompt,
      groqApiKey,
      domain,
      {
        modelName: 'moonshotai/kimi-k2-instruct-0905',
        temperature: 0.7,
        maxTokens: 500 // Increased for full paragraph (4-6 sentences)
      }
    );

    const summary = result.response.trim();

    console.log(`[CalloutGenerator] Generated enhanced summary: ${summary.substring(0, 100)}...`);

    return summary;
  } catch (error) {
    console.error('[CalloutGenerator] Error generating enhanced summary:', error);
    // Return original summary if available
    return json.summary?.content || `This comprehensive guide explores ${title}, covering key aspects and providing valuable insights for readers.`;
  }
}
