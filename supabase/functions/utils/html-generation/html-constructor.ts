// HTML constructor - generates complete HTML documents from structured JSON
// Includes callout injection, social icons, TOC, and all formatting

import { PostContentJSON, PreferencesProps, CalloutPreferences } from './types.ts';

/**
 * Process content and convert reference numbers to superscript links
 */
function processContentWithReferences(content: string): string {
  if (!content || typeof content !== 'string') {
    return content || '';
  }

  // Pattern to match reference numbers like [1], [2], etc.
  const referencePattern = /\[(\d+)\]/g;

  return content.replace(referencePattern, (match, refNumber) => {
    // Convert to superscript anchor link
    return `<sup><a href="#ref${refNumber}" class="reference-link">${refNumber}</a></sup>`;
  });
}

/**
 * Generate head section with styles
 */
function generateHead(data: PostContentJSON, preferences: PreferencesProps): string {
  const hasCustomStyle = !!preferences?.post_style_tag_main;
  const hasDomain = !!preferences?.domain;

  let stylesheet;
  if (hasCustomStyle && hasDomain) {
    stylesheet = `https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-blog-css/${preferences.domain}.css`;
  } else {
    stylesheet = `https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-blog-css/global.css`;
  }

  return `
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.title || '[Insert Blog Post Title Tag Here]'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="accessibility-styles.css">
  <link href="${stylesheet}" rel="stylesheet" />
</head>`;
}

/**
 * Generate single social icon
 */
function generateSocialIcon(
  platform: string,
  url: string,
  title: string,
  theme = 'full_color'
): string {
  if (!url) return '';

  // Get theme-specific fill color
  const getThemeColor = (platform: string, theme: string): string => {
    if (theme === 'black') return '#000000';
    if (theme === 'white') return '#ffffff';

    // Full color theme - use brand colors
    const brandColors: Record<string, string> = {
      facebook: '#1877F2',
      linkedin: '#0A66C2',
      twitter: '#000000',
      instagram: 'url(#instagram-gradient)',
      email: '#228ec2',
      phone: '#228ec2'
    };
    return brandColors[platform] || '#000000';
  };

  const icons: Record<string, { svg: string; href: string }> = {
    facebook: {
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Facebook">
              <path d="M24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 17.9895 4.3882 22.954 10.125 23.8542V15.4688H7.07812V12H10.125V9.35625C10.125 6.34875 11.9166 4.6875 14.6576 4.6875C15.9701 4.6875 17.3438 4.92188 17.3438 4.92188V7.875H15.8306C14.34 7.875 13.875 8.8 13.875 9.75V12H17.2031L16.6711 15.4688H13.875V23.8542C19.6118 22.954 24 17.9895 24 12Z" fill="${getThemeColor('facebook', theme)}" />
            </svg>`,
      href: url
    },
    linkedin: {
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="LinkedIn">
              <path d="M22.2234 0H1.77187C0.792187 0 0 0.773438 0 1.72969V22.2656C0 23.2219 0.792187 24 1.77187 24H22.2234C23.2031 24 24 23.2219 24 22.2703V1.72969C24 0.773438 23.2031 0 22.2234 0ZM7.12031 20.4516H3.55781V8.99531H7.12031V20.4516ZM5.33906 7.43438C4.19531 7.43438 3.27188 6.51094 3.27188 5.37187C3.27188 4.23281 4.19531 3.30937 5.33906 3.30937C6.47813 3.30937 7.40156 4.23281 7.40156 5.37187C7.40156 6.50625 6.47813 7.43438 5.33906 7.43438ZM20.4516 20.4516H16.8937V14.8828C16.8937 13.5562 16.8703 11.8453 15.0422 11.8453C13.1906 11.8453 12.9094 13.2937 12.9094 14.7891V20.4516H9.35625V8.99531H12.7687V10.5609H12.8156C13.2891 9.66094 14.4516 8.70938 16.1813 8.70938C19.7859 8.70938 20.4516 11.0813 20.4516 14.1656V20.4516Z" fill="${getThemeColor('linkedin', theme)}" />
            </svg>`,
      href: url
    },
    twitter: {
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Twitter">
              <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932L18.901 1.153ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z" fill="${getThemeColor('twitter', theme)}" />
            </svg>`,
      href: url
    },
    instagram: {
      svg: theme === 'full_color'
        ? `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="instagram-gradient" cx="30%" cy="107%" r="150%">
                  <stop offset="0%" stop-color="#fdf497" />
                  <stop offset="5%" stop-color="#fdf497" />
                  <stop offset="45%" stop-color="#fd5949" />
                  <stop offset="60%" stop-color="#d6249f" />
                  <stop offset="90%" stop-color="#285AEB" />
                </radialGradient>
              </defs>
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" fill="url(#instagram-gradient)" />
            </svg>`
        : `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" fill="${getThemeColor('instagram', theme)}" />
            </svg>`,
      href: url
    },
    email: {
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Email">
              <path d="M21.6 2.40039H2.4C1.08 2.40039 0.012 3.48039 0.012 4.80039L0 19.2004C0 20.5204 1.08 21.6004 2.4 21.6004H21.6C22.92 21.6004 24 20.5204 24 19.2004V4.80039C24 3.48039 22.92 2.40039 21.6 2.40039ZM21.6 6.78471C21.6 7.0433 21.4668 7.28365 21.2475 7.4207L12.3975 12.952C12.1543 13.104 11.8457 13.104 11.6025 12.952L2.7525 7.4207C2.53322 7.28365 2.4 7.0433 2.4 6.78471V6.15358C2.4 5.5645 3.04796 5.20537 3.5475 5.51758L11.6025 10.552C11.8457 10.704 12.1543 10.704 12.3975 10.552L20.4525 5.51758C20.952 5.20537 21.6 5.5645 21.6 6.15358V6.78471Z" fill="${getThemeColor('email', theme)}" />
            </svg>`,
      href: `mailto:${url}`
    },
    phone: {
      svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Phone">
              <path d="M8.45059 9.40023C9.14659 10.8498 10.0954 12.2085 11.297 13.4101C12.4985 14.6116 13.8572 15.5604 15.3068 16.2564C15.4315 16.3163 15.4938 16.3462 15.5727 16.3692C15.8531 16.451 16.1973 16.3923 16.4348 16.2222C16.5016 16.1744 16.5587 16.1172 16.673 16.0029C17.0226 15.6533 17.1975 15.4785 17.3732 15.3642C18.0361 14.9332 18.8907 14.9332 19.5536 15.3642C19.7294 15.4785 19.9042 15.6533 20.2538 16.0029L20.4486 16.1978C20.9801 16.7292 21.2458 16.995 21.3902 17.2803C21.6772 17.8479 21.6772 18.5182 21.3902 19.0857C21.2458 19.3711 20.9801 19.6368 20.4486 20.1683L20.291 20.3259C19.7614 20.8555 19.4966 21.1203 19.1365 21.3226C18.737 21.547 18.1165 21.7084 17.6583 21.707C17.2454 21.7058 16.9632 21.6257 16.3987 21.4655C13.3653 20.6045 10.503 18.98 8.11497 16.592C5.72699 14.2041 4.10252 11.3417 3.24155 8.30831C3.08134 7.74386 3.00124 7.46164 3.00001 7.04869C2.99864 6.59047 3.16001 5.96998 3.38443 5.57047C3.58667 5.21044 3.85149 4.94563 4.38111 4.41601L4.53874 4.25837C5.07019 3.72693 5.33591 3.46121 5.62129 3.31687C6.18885 3.02979 6.85912 3.02979 7.42668 3.31686C7.71206 3.46121 7.97778 3.72693 8.50922 4.25837L8.70409 4.45324C9.0537 4.80285 9.2285 4.97765 9.34279 5.15343C9.77378 5.81632 9.77378 6.6709 9.34278 7.33379C9.2285 7.50957 9.0537 7.68437 8.70409 8.03398C8.58978 8.14829 8.53262 8.20545 8.48478 8.27226C8.31477 8.50969 8.25607 8.85395 8.33779 9.1343C8.36079 9.21319 8.39072 9.27554 8.45059 9.40023Z" fill="${getThemeColor('phone', theme)}" />
            </svg>`,
      href: `tel:${url}`
    }
  };

  const icon = icons[platform];
  if (!icon) return '';

  return `
          <a rel="noreferrer noopener" target="_blank" title="${title}" href="${icon.href}">
            ${icon.svg}
          </a>`;
}

/**
 * Generate all social icons
 */
function generateSocialIcons(
  companyInfo: any,
  preferences: PreferencesProps
): string {
  const socialLinks = companyInfo?.social_links || {};
  const theme = preferences?.social_icon_theme || 'full_color';

  const socialPlatforms = [
    { platform: 'facebook', title: 'Facebook', url: socialLinks.facebook || preferences?.facebook },
    { platform: 'linkedin', title: 'LinkedIn', url: socialLinks.linkedin || preferences?.linkedin },
    { platform: 'twitter', title: 'Twitter', url: socialLinks.twitter || preferences?.twitter },
    { platform: 'instagram', title: 'Instagram', url: socialLinks.instagram || preferences?.instagram },
    { platform: 'email', title: 'Email', url: socialLinks.email || preferences?.email },
    { platform: 'phone', title: 'Phone', url: socialLinks.phone || preferences?.phone }
  ];

  return socialPlatforms
    .filter(social => social.url)
    .map(social => generateSocialIcon(social.platform, social.url!, social.title, theme))
    .join('');
}

/**
 * Generate table of contents
 */
function generateTableOfContents(data: PostContentJSON): string {
  const sections = data.sections || [];
  const sectionLinks: string[] = [];

  sections.forEach((section, sectionIndex) => {
    const sectionId = `Section_${sectionIndex + 1}`;

    const subsections = section.subsections && section.subsections.length > 0
      ? section.subsections.map((subsection, subsectionIndex) => {
        const subsectionId = `${sectionId}_SubSection_${subsectionIndex + 1}`;
        return `<li><a href="#${subsectionId}">${subsection.heading || `Subsection ${subsectionIndex + 1}`}</a></li>`;
      }).join('')
      : '';

    if (section.heading || (section.subsections && section.subsections.length > 0)) {
      sectionLinks.push(`
            <li>
            <details>
              <summary>
                  <a href="#${sectionId}">${section.heading || `Section ${sectionIndex + 1}`}</a>
              </summary>
                <ul>${subsections}</ul>
            </details>
          </li>`);
    }
  });

  return `
      <div id="toc">
        <b>Table of Contents</b>
        <ul>
            <li><a href="#summary">Summary</a></li>${sectionLinks.join('')}
          <li><a href="#conclusion">Conclusion</a></li>
          <li><a href="#references">References</a></li>
        </ul>
      </div>`;
}

/**
 * Insert callouts into HTML content after H2 headings
 */
export function insertCallouts(
  htmlContent: string,
  calloutTexts: Map<string, string>,
  calloutPreferences: CalloutPreferences
): string {
  console.log('[HTMLConstructor] Inserting callouts into HTML...');

  // Parse HTML to find H2 sections
  const h2Pattern = /<h2[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h2>/g;
  const specialSections = ['summary', 'toc', 'key-takeaways', 'key takeaways', 'references', 'conclusion'];

  let sectionCount = 0;
  let replacementsMade = 0;

  const result = htmlContent.replace(h2Pattern, (match, id, heading) => {
    // Skip special sections
    if (specialSections.some(special => id.toLowerCase().includes(special))) {
      console.log(`[HTMLConstructor] Skipping special section: ${heading}`);
      return match;
    }

    // Get callout text for this section
    const calloutText = calloutTexts.get(heading.trim());
    if (!calloutText) {
      console.warn(`[HTMLConstructor] No callout text found for section: ${heading}`);
      return match;
    }

    // Determine position (even = left, odd = right)
    const isLeft = sectionCount % 2 === 0;
    const position = isLeft ? 'left' : 'right';
    sectionCount++;

    // Select template and CTA values
    const template = isLeft
      ? calloutPreferences.post_callout_left
      : calloutPreferences.post_callout_right;

    const ctaUrl = isLeft
      ? calloutPreferences.callout_left_cta_dest_url
      : calloutPreferences.callout_right_cta_dest_url;

    const ctaText = isLeft
      ? calloutPreferences.callout_left_cta_anchor_text
      : calloutPreferences.callout_right_cta_anchor_text;

    // Replace placeholders in template
    const calloutHtml = template
      .replace(/\{callout_text\}/g, calloutText)
      .replace(/\{cta_url\}/g, ctaUrl)
      .replace(/\{cta_text\}/g, ctaText)
      .replace(/\{position\}/g, position);

    replacementsMade++;
    console.log(`[HTMLConstructor] Inserted ${position} callout for section: ${heading}`);

    // Insert callout after H2 heading
    return match + '\n' + calloutHtml;
  });

  console.log(`[HTMLConstructor] Inserted ${replacementsMade} callouts into HTML`);

  return result;
}

/**
 * Generate blog content sections
 */
function generateBlogContent(
  data: PostContentJSON,
  preferences: PreferencesProps
): string {
  let content = '';

  // Summary Section
  const summaryContent = data.summary?.content || `This comprehensive guide explores ${data.title || 'the topic'}, covering key aspects and providing valuable insights for readers.`;

  content += `
  <!-- Start: Summary  -->
  <div id="summary">
    <b>Summary</b>
    <p>${summaryContent}</p>
  </div>
  <!-- End: Summary  -->`;

  // Main Sections
  const sections = data.sections || [];

  sections.forEach((section, sectionIndex) => {
    const sectionId = `Section_${sectionIndex + 1}`;

    content += `
    <h2 id="${sectionId}">${section.heading || `Section ${sectionIndex + 1}`}</h2>`;

    if (section.subsections && section.subsections.length > 0) {
      section.subsections.forEach((subsection, subsectionIndex) => {
        const subsectionId = `${sectionId}_SubSection_${subsectionIndex + 1}`;

        content += `
        <h3 id="${subsectionId}">${subsection.heading || `Subsection ${subsectionIndex + 1}`}</h3>`;

        // Handle different content types
        if (subsection.content_type === 'list' && subsection.list_items && subsection.list_items.length > 0) {
          content += `
        <ul>`;
          subsection.list_items.forEach(item => {
            const processedItem = processContentWithReferences(item);
            content += `
          <li>${processedItem}</li>`;
          });
          content += `
        </ul>`;
        } else if (subsection.content_type === 'ordered_list' && subsection.list_items && subsection.list_items.length > 0) {
          content += `
        <ol>`;
          subsection.list_items.forEach(item => {
            const processedItem = processContentWithReferences(item);
            content += `
          <li>${processedItem}</li>`;
          });
          content += `
        </ol>`;
        } else {
          const processedContent = processContentWithReferences(subsection.content || 'Content not available');
          content += `
        <p>${processedContent}</p>`;
        }
      });
    }
  });

  // Quote Section (if exists)
  if (data.quote) {
    content += `
    <!-- Start: Quote -->
    <div class="quote">
      <div class="quote_wide_text">
        "${data.quote.text}"
      </div>
      <div class="quote_wide_source_name">${data.quote.author_name}</div>
      <div class="quote_wide_source_title">${data.quote.author_title}${data.quote.author_company ? ', ' + data.quote.author_company : ''}</div>
    </div>
    <!-- End: Quote -->`;
  }

  // Conclusion Section
  content += `
  <h2 id="conclusion">Conclusion</h2>
  <p>${data.conclusion?.content || `In conclusion, ${data.title || 'this topic'} represents a critical area of focus that requires careful consideration and strategic implementation.`}${data.conclusion?.cta_text && data.conclusion?.cta_url ? ` <a href="${data.conclusion.cta_url}" target="_blank" rel="noreferrer noopener">${data.conclusion.cta_text}</a>` : ''}</p>`;

  // Key Takeaways Section
  content += `
  <!-- Start: Key Takeaways -->
  <div id="key-takeaways">
    <h2>Key Takeaways</h2>
    <p>
      ${data.key_takeaways?.description || `Key insights and actionable strategies from this comprehensive guide.`}
    </p>
    <ol>`;

  if (data.key_takeaways?.items && data.key_takeaways.items.length > 0) {
    data.key_takeaways.items.forEach((item) => {
      content += `
      <li>${item}</li>`;
    });
  } else {
    const fallbackItems = [
      'Understanding the fundamentals is crucial for long-term success',
      'Strategic planning and careful execution lead to better outcomes',
      'Continuous improvement and adaptation ensure ongoing effectiveness'
    ];
    fallbackItems.forEach((item) => {
      content += `
      <li>${item}</li>`;
    });
  }

  content += `
    </ol>
    <!-- Start: Key Takeaways CTA -->
    <div class="key_takeaways_cta_button">
      <a class="key_takeaways_cta_dest_url" href="${data.key_takeaways?.cta_url || preferences?.key_takeaways_cta_dest_url || '#'}">
        <span class="key_takeaways_cta_anchor_text">${data.key_takeaways?.cta_text || preferences?.key_takeaways_cta_anchor_text || 'Get In Touch'}</span>
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M1.07178 7.27418L4.34559 4.00037L1.07178 0.726562M5.65511 7.27418L8.92892 4.00037L5.65511 0.726562"
            stroke-width="1.30952" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </a>
    </div>
    <!-- End: Key Takeaways CTA -->
  </div>
  <!-- End: Key Takeaways -->`;

  // References Section
  content += `
  <!-- Start: References  -->
  <div id="references">
    <h2>References</h2>
    <ol>`;

  if (data.references && data.references.length > 0) {
    data.references.forEach((ref, refIndex) => {
      content += `
      <li id="ref${refIndex + 1}">
        <a href="${ref.url}" target="_blank" rel="noreferrer noopener">${ref.citation}</a>
      </li>`;
    });
  } else {
    content += `
      <li id="ref1">
        <a href="https://example.com" target="_blank" rel="noreferrer noopener">Example Reference</a>
      </li>`;
  }

  content += `
    </ol>
  </div>
  <!-- End: References  -->`;

  return content;
}

/**
 * Generate body section
 */
function generateBody(
  data: PostContentJSON,
  preferences: PreferencesProps
): string {
  return `
<body>
  <!-- Skip Navigation Link -->
  <a href="#main-content" class="skip-link" style="position: absolute; top: -40px; left: 6px; background: #000; color: #fff; padding: 8px; text-decoration: none; z-index: 1000; border-radius: 4px; font-weight: bold;">Skip to main content</a>

  <!-- Start: Lead Section  -->
  <div class="lead-section">
    <div class="title-container">
      <h1>${data.title || '[Insert Blog Post Headline Here]'}</h1>
      <div class="lead-meta">
        <div class="byline">
          <a href="${data.author?.social_links?.website || '#'}" target="_blank" rel="noreferrer noopener">
            ${data.author?.name || preferences?.author_name || 'Author'}
          </a>
        </div>
        <div class="dateline">${data.publish_date ? new Date(data.publish_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        <div class="readtimeline">${data.read_time || Math.ceil(data.sections?.reduce((total, section) => total + (section.subsections?.length || 0), 0) * 2) || 7} min read</div>
      </div>
    </div>
    <div class="lead-image-container">
      <div class="lead-image">
        <img src="${data.hero_image?.url || 'https://loud.us/wp-content/uploads/2025/07/brentdpayne_a_photorealistic_brightly-lit_summer_time_wide-an_19f77735-bd00-485f-b1b7-5945aa1f6e49_0.png'}" alt="${data.hero_image?.alt_text || data.title || 'Hero image'}">
      </div>
    </div>
  </div>
  <!-- End: Lead Section  -->

  <!-- Start: Blog Wrapper Section  -->
  <div class="blog-wrapper">
    <div class="flex-container">
      <!-- Start: About Company  -->
      <div class="about_company">
        <span class="about_company_title">About ${data.company_info?.name || preferences?.company_name || 'Company'}</span>
        <span class="about_company_text">${data.company_info?.description || preferences?.about_company || 'Company description goes here.'}</span>
        <div class="about_company_social">
          ${generateSocialIcons(data.company_info, preferences)}
        </div>
      </div>
      <!-- End: About Company  -->
      <!--Start TOC-->
      ${generateTableOfContents(data)}
      <!-- End: TOC  -->
    </div>
    <main id="main-content" role="main" class="blog-content">
      ${generateBlogContent(data, preferences)}
    </main>
  </div>
  <!-- End: Blog Wrapper Section  -->
  <script src="https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-blog-css/toc.js" defer></script>
</body>`;
}

/**
 * Main function to construct complete HTML document
 */
export async function constructHTML(
  data: PostContentJSON,
  preferences: PreferencesProps,
  calloutPreferences: CalloutPreferences,
  calloutTexts: Map<string, string>
): Promise<string> {
  console.log('[HTMLConstructor] Starting HTML construction...');

  // Generate head and body
  const head = generateHead(data, preferences);
  const body = generateBody(data, preferences);

  // Combine into full HTML
  let html = `<!DOCTYPE html>
<html lang="en">
${head}
${body}
</html>`;

  // Insert callouts if we have them
  if (calloutTexts && calloutTexts.size > 0) {
    console.log(`[HTMLConstructor] Inserting ${calloutTexts.size} callouts...`);
    html = insertCallouts(html, calloutTexts, calloutPreferences);
  } else {
    console.warn('[HTMLConstructor] No callouts to insert');
  }

  console.log('[HTMLConstructor] HTML construction complete');
  console.log(`[HTMLConstructor] Final HTML length: ${html.length} characters`);

  return html;
}
