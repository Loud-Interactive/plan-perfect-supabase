// Content Perfect Markdown Utilities
// Functions for handling markdown conversion to HTML and content formatting

/**
 * Converts markdown to HTML with Claude
 * @param markdownText Markdown content to convert
 * @param clientSynopsis Client preferences object
 * @returns HTML content
 */
export const markdownToHtml = async (
  markdownText: string,
  clientSynopsis: Record<string, any>
): Promise<string> => {
  try {
    const apiKey = Deno.env.get('CLAUDE_API_KEY');
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY is not set');
    }

    // Determine if we should include a conclusion based on client preferences
    const includeConclusion = clientSynopsis.enable_conclusion !== false;
    
    // Create prompt for Claude
    const prompt = `
You are an expert HTML converter that transforms markdown into clean, semantic HTML markup.

# Client Information
${clientSynopsis.synopsis ? `Client synopsis: ${clientSynopsis.synopsis}\n` : ''}
${clientSynopsis.writing_style ? `Writing style: ${clientSynopsis.writing_style}\n` : ''}
${clientSynopsis.tone ? `Tone: ${clientSynopsis.tone}\n` : ''}

# Input Markdown Content
${markdownText}

# Instructions
Convert the provided markdown into clean, semantic HTML with the following specifications:

1. Use proper semantic HTML5 tags (article, section, h1-h6, p, ul, ol, blockquote, etc.)
2. Structure the content with appropriate heading hierarchy
3. Format lists, links, bold, and italic text correctly
4. Preserve the original writing style and tone
5. Include all content, nothing should be removed
${includeConclusion ? '6. Ensure the conclusion section is appropriately formatted' : ''}

Respond ONLY with the final HTML markup, nothing else. Do not include any explanations or discussions about the conversion process.
`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        temperature: 0.0,
        system: 'You are an expert HTML converter that only outputs valid HTML code without any explanations.',
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let htmlContent = data.content?.[0]?.text || '';

    // Handle any wrapping tags Claude might add
    const htmlContentMatch = htmlContent.match(/<article>(.*?)<\/article>/s);
    if (htmlContentMatch) {
      htmlContent = htmlContentMatch[1].trim();
    }

    return htmlContent;
  } catch (error) {
    console.error('Error converting markdown to HTML with Claude:', error);
    // Provide basic HTML conversion as fallback
    return `<div>${markdownText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br />')}</div>`;
  }
};

/**
 * Creates a simple HTML document with head and body sections
 * @param bodyContent HTML content for the body
 * @param title Document title
 * @param description Meta description
 * @returns Complete HTML document
 */
export const createHtmlDocument = (
  bodyContent: string,
  title: string,
  description?: string
): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${description ? `<meta name="description" content="${description}">` : ''}
</head>
<body>
  <article>
    <h1>${title}</h1>
    ${bodyContent}
  </article>
</body>
</html>`;
};

/**
 * Adds citations to HTML content from references data
 * @param htmlContent HTML content
 * @param references References data from sections
 * @returns HTML with citations
 */
export const addCitationsToHtml = (
  htmlContent: string,
  references: any[]
): string => {
  let updatedHtml = htmlContent;
  
  // If there are no references, return the original content
  if (!references || references.length === 0) {
    return htmlContent;
  }
  
  // Add citations to HTML content
  let citationNumber = 1;
  const citationsMap: Record<string, number> = {};
  
  // First pass: identify all unique references and assign numbers
  for (const ref of references) {
    const url = ref.url;
    if (url && !citationsMap[url]) {
      citationsMap[url] = citationNumber++;
    }
  }
  
  // Second pass: add references section to HTML
  let referencesHtml = '<h2>References</h2>\n<ol>\n';
  
  for (const url in citationsMap) {
    const ref = references.find(r => r.url === url);
    if (ref) {
      const title = ref.title || url;
      referencesHtml += `  <li id="ref-${citationsMap[url]}"><a href="${url}" target="_blank">${title}</a></li>\n`;
    }
  }
  
  referencesHtml += '</ol>';
  
  // Add references section if it doesn't exist
  if (!updatedHtml.includes('<h2>References</h2>')) {
    updatedHtml += `\n\n${referencesHtml}`;
  }
  
  return updatedHtml;
};

/**
 * Adds custom CSS styles to HTML content
 * @param htmlContent HTML content
 * @param styleSettings Style settings from preferences
 * @returns HTML with added styles
 */
export const addStylesToHtml = (
  htmlContent: string,
  styleSettings: Record<string, any>
): string => {
  // Extract style content from preferences
  const styleContent = styleSettings.post_style_tag_main || styleSettings.Post_Style || '';
  
  if (!styleContent) {
    return htmlContent;
  }
  
  // Remove any existing style tags
  let updatedHtml = htmlContent.replace(/<style[^>]*>.*?<\/style>/s, '');
  
  // Create new style tag
  const styleTag = `<style>${styleContent}</style>`;
  
  // Insert after head tag if it exists, otherwise at the start
  if (updatedHtml.includes('<head>')) {
    updatedHtml = updatedHtml.replace('<head>', `<head>${styleTag}`);
  } else {
    updatedHtml = `${styleTag}${updatedHtml}`;
  }
  
  return updatedHtml;
};