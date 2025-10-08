// Content Perfect Schema Utilities
// Functions for generating and managing schema.org structured data

/**
 * Generates basic schema.org Article structured data
 * @param title Article title
 * @param description Article description
 * @param domain Publisher domain
 * @param authorName Author name (defaults to domain)
 * @returns Schema.org structured data object
 */
export const generateBasicArticleSchema = (
  title: string,
  description: string,
  domain: string,
  authorName?: string
): Record<string, any> => {
  // Generate current date for datePublished
  const publishedDate = new Date().toISOString();

  // Create the schema object
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": title,
    "description": description,
    "author": {
      "@type": "Organization",
      "name": authorName || domain,
      "url": `https://${domain}`
    },
    "publisher": {
      "@type": "Organization",
      "name": domain,
      "url": `https://${domain}`
    },
    "datePublished": publishedDate,
    "dateModified": publishedDate,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://${domain}`
    }
  };
};

/**
 * Extracts the first paragraph from HTML content for description
 * @param htmlContent HTML content
 * @returns First paragraph text or empty string
 */
export const extractFirstParagraph = (htmlContent: string): string => {
  if (!htmlContent) return '';
  
  const firstParagraphMatch = htmlContent.match(/<p>(.*?)<\/p>/);
  if (firstParagraphMatch && firstParagraphMatch[1]) {
    // Remove any HTML tags from the paragraph text
    return firstParagraphMatch[1].replace(/<[^>]*>/g, '');
  }
  
  return '';
};

/**
 * Generates schema.org data using domain preferences
 * @param title Article title
 * @param htmlContent HTML content
 * @param domain Publisher domain
 * @param schemaSettings Schema settings from preferences
 * @returns Schema.org structured data object
 */
export const generateSchemaWithPreferences = (
  title: string,
  htmlContent: string,
  domain: string,
  schemaSettings: Record<string, any>
): Record<string, any> => {
  // Extract description from first paragraph
  const description = extractFirstParagraph(htmlContent);
  
  // Check if we have a template in the preferences
  const schemaTemplate = schemaSettings.JSON_LD_Schema_Post_Template || schemaSettings.json_ld_schema_template;
  
  if (schemaTemplate) {
    try {
      // Parse the template
      const templateObj = JSON.parse(schemaTemplate);
      
      // Fill in dynamic values
      templateObj.headline = title;
      templateObj.description = description;
      templateObj.datePublished = new Date().toISOString();
      templateObj.dateModified = new Date().toISOString();
      
      // Handle author and publisher URLs
      if (templateObj.author && templateObj.author['@type'] === 'Organization') {
        templateObj.author.url = `https://${domain}`;
      }
      
      if (templateObj.publisher && templateObj.publisher['@type'] === 'Organization') {
        templateObj.publisher.url = `https://${domain}`;
      }
      
      if (templateObj.mainEntityOfPage && templateObj.mainEntityOfPage['@type'] === 'WebPage') {
        templateObj.mainEntityOfPage['@id'] = `https://${domain}`;
      }
      
      return templateObj;
    } catch (error) {
      console.error('Error parsing schema template:', error);
      // Fall back to basic schema
    }
  }
  
  // Fall back to basic schema
  return generateBasicArticleSchema(title, description, domain);
};

/**
 * Injects schema.org JSON-LD data into HTML content
 * @param htmlContent Original HTML content
 * @param schemaData Schema.org structured data object
 * @returns HTML with schema.org JSON-LD script tag
 */
export const injectSchemaData = (
  htmlContent: string,
  schemaData: Record<string, any>
): string => {
  // Create JSON-LD script tag
  const schemaScript = `<script type="application/ld+json">${JSON.stringify(schemaData, null, 2)}</script>`;
  
  // Check if there's already a JSON-LD script in the HTML
  const hasExistingSchema = /<script\s+type="application\/ld\+json"/.test(htmlContent);
  
  if (hasExistingSchema) {
    // Replace existing schema
    return htmlContent.replace(
      /<script\s+type="application\/ld\+json".*?<\/script>/s,
      schemaScript
    );
  } else {
    // Insert schema before closing head tag
    if (htmlContent.includes('</head>')) {
      return htmlContent.replace('</head>', `${schemaScript}\n</head>`);
    } else {
      // If no head tag, add at the beginning
      return `${schemaScript}\n${htmlContent}`;
    }
  }
};