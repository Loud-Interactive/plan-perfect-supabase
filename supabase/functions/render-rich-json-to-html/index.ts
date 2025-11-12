import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
/**
 * Helper function to update task status
 */ async function updateTaskStatus(supabaseClient, taskId, outlineGuid, status) {
  if (!taskId && !outlineGuid) return;
  try {
    if (taskId) {
      await supabaseClient.from('tasks').update({
        status
      }).eq('task_id', taskId);
    } else if (outlineGuid) {
      await supabaseClient.from('tasks').update({
        status
      }).eq('content_plan_outline_guid', outlineGuid);
    }
    console.log(`[Status] Updated to: ${status}`);
  } catch (error) {
    console.warn(`[Status] Failed to update status to ${status}:`, error);
  }
}
/**
 * Create URL-friendly ID from text
 */ function createId(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').trim();
}
/**
 * Generate Table of Contents HTML
 * Note: Template already provides <div id="toc"> wrapper, so we only return inner content
 */ function generateTOC(article) {
  let toc = `<b>Table of Contents</b>
  <ul>
    <li><a href="#summary">Summary</a></li>\n`;
  article.sections.forEach((section, sectionIdx)=>{
    const sectionId = `Section_${sectionIdx + 1}`;
    if (section.subsections.length > 0) {
      toc += `    <li>
      <details>
        <summary>
          <a href="#${sectionId}">${section.heading}</a>
        </summary>
        <ul>\n`;
      section.subsections.forEach((subsection, subIdx)=>{
        const subsectionId = `${sectionId}_SubSection_${subIdx + 1}`;
        const subsectionTitle = subsection.heading || subsection.title || `Subsection ${subIdx + 1}`;
        toc += `          <li>
            <a href="#${subsectionId}">${subsectionTitle}</a>
          </li>\n`;
      });
      toc += `        </ul>
      </details>
    </li>\n`;
    } else {
      toc += `    <li><a href="#${sectionId}">${section.heading}</a></li>\n`;
    }
  });
  toc += `    <li><a href="#key-takeaways">Key Takeaways</a></li>
    <li><a href="#references">References</a></li>
  </ul>`;
  return toc;
}
/**
 * Generate Summary HTML
 */ function generateSummary(summary) {
  return `<b>Summary</b>
  <p>
    ${summary.content}
  </p>`;
}
/**
 * Generate Callout HTML
 */ function generateCallout(calloutText, position, ctaUrl, ctaText) {
  if (!calloutText) return '';
  const side = position === 'left' ? 'left' : 'right';
  return `<!-- Start: Callout ${side === 'left' ? 'Left' : 'Right'}  -->
<div class="callout callout_${side}">
  <p class="callout_text">
    ${calloutText}
  </p>
  <!-- Start: Callout ${side === 'left' ? 'Left' : 'Right'} CTA -->
  <div class="callout_${side}_cta_button">
    <a class="callout_${side}_cta_dest_url" href="${ctaUrl || '#'}">
      <span class="callout_${side}_cta_anchor_text"> ${ctaText || 'Learn More'} </span>
      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M1.07178 7.27418L4.34559 4.00037L1.07178 0.726562M5.65511 7.27418L8.92892 4.00037L5.65511 0.726562"
          stroke-width="1.30952" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </a>
  </div>
  <!-- End: Callout ${side === 'left' ? 'Left' : 'Right'} CTA -->
</div>
<!-- End: Callout ${side === 'left' ? 'Left' : 'Right'}  -->`;
}
function convertReferencesToLinks(content) {
  return content.replace(/\[(\d+)\]/g, '<sup><a href="#ref$1" class="reference-link">[$1]</a></sup>');
}
/**
 * Generate Body Content HTML
 */ function generateBodyContent(article, pairsData) {
  let html = '';
  // Get CTA preferences from pairsData with defaults
  const leftCtaUrl = pairsData?.callout_left_cta_dest_url || '#';
  const leftCtaText = pairsData?.callout_left_cta_anchor_text || 'Learn More';
  const rightCtaUrl = pairsData?.callout_right_cta_dest_url || '#';
  const rightCtaText = pairsData?.callout_right_cta_anchor_text || 'Learn More';
  article.sections.forEach((section, sectionIdx)=>{
    const sectionId = `Section_${sectionIdx + 1}`;
    html += `\n<h2 id="${sectionId}">
  ${section.heading}
</h2>\n`;
    // Insert callout right after H2 heading if section has one
    if (section.callout && section.callout.text) {
      const ctaUrl = section.callout.position === 'left' ? leftCtaUrl : rightCtaUrl;
      const ctaText = section.callout.position === 'left' ? leftCtaText : rightCtaText;
      html += '\n' + generateCallout(section.callout.text, section.callout.position, ctaUrl, ctaText) + '\n\n';
    }
    section.subsections.forEach((subsection, subIdx)=>{
      const subsectionId = `${sectionId}_SubSection_${subIdx + 1}`;
      const subsectionTitle = subsection.heading || subsection.title || '';
      // Only render H3 if there's a title
      if (subsectionTitle) {
        html += `<h3 id="${subsectionId}">${subsectionTitle}</h3>\n`;
      }
      // Split content into paragraphs (rough split by sentences)
      const sentences = subsection.content.match(/[^.!?]+[.!?]+/g) || [
        subsection.content
      ];
      const paragraphSize = Math.ceil(sentences.length / 3) // Aim for ~3 paragraphs per subsection
      ;
      for(let i = 0; i < sentences.length; i += paragraphSize){
        const paragraphSentences = sentences.slice(i, i + paragraphSize);
        html += `<p>\n  ${paragraphSentences.join(' ').trim()}\n</p>\n`;
      }
      html += '\n';
    });
  });
  return convertReferencesToLinks(html);
}
/**
 * Generate Key Takeaways HTML
 */ function generateKeyTakeaways(keyPoints) {
  let html = `<!-- Start: Key Takeaways  -->
<div id="key-takeaways">
  <b>Key Takeaways</b>
  <p>
    ${keyPoints[0] || 'Key insights from this article.'}
  </p>
  <ol>\n`;
  keyPoints.slice(0, 7).forEach((point)=>{
    html += `    <li>
      ${point}
    </li>\n`;
  });
  html += `  </ol>
  <!-- Start: Key Takeaways CTA -->
  <div class="key_takeaways_cta_button">
    <a class="key_takeaways_cta_dest_url" href="#">
      <span class="key_takeaways_cta_anchor_text">Learn More</span>
      <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M1.07178 7.27418L4.34559 4.00037L1.07178 0.726562M5.65511 7.27418L8.92892 4.00037L5.65511 0.726562"
          stroke-width="1.30952" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </a>
  </div>
  <!-- End: Key Takeaways CTA -->
</div>
<!-- End: Key Takeaways  -->`;
  return html;
}
/**
 * Generate References HTML
 */ function generateReferences(references) {
  let html = `<!-- Start: References  -->
<div id="references">
  <b>References
  </b>
  <ol>\n`;
  references.forEach((ref)=>{
    html += `    <li id="ref${ref.number}">
      <a href="${ref.url}">${ref.url}</a>
    </li>\n`;
  });
  html += `  </ol>
</div>
<!-- End: References  -->`;
  return html;
}
/**
 * Calculate read time based on word count
 */ function calculateReadTime(wordCount) {
  const minutes = Math.ceil(wordCount / 200);
  return `${minutes} min read`;
}
/**
 * Validate that a custom template contains required placeholders
 */
function validateCustomTemplate(template) {
  // Critical placeholders - template will fail without these
  const criticalPlaceholders = [
    '{{TITLE_TAG}}',         // Required for <title> in head
    '{{META_DESCRIPTION}}',  // Required for SEO meta tag
    '{{BODY_CONTENT}}'       // Required for main article content
  ];

  // Recommended placeholders - template will work but may look incomplete
  const recommendedPlaceholders = [
    '{{JSON_LD}}',           // Structured data for SEO
    '{{TOC_SECTION}}',       // Table of contents
    '{{SUMMARY_SECTION}}',   // Article summary
    '{{KEY_TAKEAWAYS}}',     // Key points section
    '{{REFERENCES}}'         // Citations/references section
  ];

  const missingCritical = criticalPlaceholders.filter(placeholder =>
    !template.includes(placeholder)
  );

  const missingRecommended = recommendedPlaceholders.filter(placeholder =>
    !template.includes(placeholder)
  );

  return {
    isValid: missingCritical.length === 0,
    missingCritical,
    missingRecommended
  };
}
/**
 * Inject CSS links and custom styles into template head
 */ function injectCSS(template, domain, pairsData, customStyles = '') {
  const baseUrl = 'https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-blog-css';
  let headInjection = '<script src="https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-blog-css/toc.js" defer=""></script>';
  // If they have custom domain CSS, use ONLY that (not global)
  // Otherwise, fall back to global.css
  if (pairsData?.post_style_tag_main) {
    console.log(`Using custom domain CSS: ${domain}.css`);
    headInjection += `<link rel="stylesheet" href="${baseUrl}/${domain}.css">`;
  } else {
    console.log('Using global.css (no custom domain CSS)');
    headInjection += `<link rel="stylesheet" href="${baseUrl}/global.css">`;
  }
  // Add custom inline styles if they exist
  if (customStyles) {
    headInjection += `\n  ${customStyles}`;
  }
  // Inject before closing </head> tag
  return template.replace('</head>', `  ${headInjection}\n</head>`);
}
/**
 * Generate JSON-LD structured data
 */ function generateJsonLD(article, domain, heroImageUrl) {
  const jsonLD = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.title,
    "author": {
      "@type": "Organization",
      "name": domain || "Publisher"
    },
    "datePublished": new Date().toISOString(),
    "image": heroImageUrl || "https://via.placeholder.com/1200x630"
  };
  return JSON.stringify(jsonLD, null, 2);
}
/**
 * Generate social links HTML
 */ function generateSocialLinks(pairsData) {
  if (!pairsData) return '';
  let html = '';
  if (pairsData.facebook) {
    html += `<a href="${pairsData.facebook}" class="social-link facebook" target="_blank" rel="noopener" title="Facebook">
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
  <path
    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
    fill="currentColor" />
</svg></a>\n      `;
  }
  if (pairsData.twitter) {
    html += `<a href="${pairsData.twitter}" class="social-link twitter" target="_blank" rel="noopener" title="Twitter">  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932L18.901 1.153ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z"
                fill="currentColor" />
            </svg></a>\n      `;
  }
  if (pairsData.linkedin) {
    html += `<a href="${pairsData.linkedin}" class="social-link linkedin" target="_blank" rel="noopener" title="LinkedIn">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.2234 0H1.77187C0.792187 0 0 0.773438 0 1.72969V22.2656C0 23.2219 0.792187 24 1.77187 24H22.2234C23.2031 24 24 23.2219 24 22.2703V1.72969C24 0.773438 23.2031 0 22.2234 0ZM7.12031 20.4516H3.55781V8.99531H7.12031V20.4516ZM5.33906 7.43438C4.19531 7.43438 3.27188 6.51094 3.27188 5.37187C3.27188 4.23281 4.19531 3.30937 5.33906 3.30937C6.47813 3.30937 7.40156 4.23281 7.40156 5.37187C7.40156 6.50625 6.47813 7.43438 5.33906 7.43438ZM20.4516 20.4516H16.8937V14.8828C16.8937 13.5562 16.8703 11.8453 15.0422 11.8453C13.1906 11.8453 12.9094 13.2937 12.9094 14.7891V20.4516H9.35625V8.99531H12.7687V10.5609H12.8156C13.2891 9.66094 14.4516 8.70938 16.1813 8.70938C19.7859 8.70938 20.4516 11.0813 20.4516 14.1656V20.4516Z" fill="currentColor"/></svg></a>\n      `;
  }
  if (pairsData.instagram) {
    html += `<a href="${pairsData.instagram}" class="social-link instagram" target="_blank" rel="noopener" title="Instagram">            <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
              <path
                d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"
                fill="currentColor" />
            </svg></a>\n      `;
  }
  return html.trim();
}
/**
 * Render the rich JSON into the HTML template
 */ function renderToHTML(article, template, domain, pairsData, customStyles = '', heroImageUrl = null) {
  // Generate all sections
  const toc = generateTOC(article);
  const summary = generateSummary(article.summary);
  const bodyContent = generateBodyContent(article, pairsData);
  const keyTakeaways = generateKeyTakeaways(article.summary.key_points);
  const references = generateReferences(article.references);
  const readTime = calculateReadTime(article.metadata.word_count);
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const jsonLD = generateJsonLD(article, domain, heroImageUrl);
  const socialLinks = generateSocialLinks(pairsData);
  const aboutCompanyText = pairsData?.about_company || pairsData?.synopsis || 'Learn more about our company and what we do.';
  const aboutCompanyTitle = pairsData?.about_company_title || 'About Us';
  const authorName = pairsData?.author_name || 'Author';
  const authorUrl = pairsData?.author_url || '#';
  // Default hero image if none provided
  const leadImageUrl = heroImageUrl || 'https://via.placeholder.com/1200x630';
  // Replace all {{PLACEHOLDER}} patterns in new template format
  let html = template.replace(/{{TITLE_TAG}}/g, article.title).replace(/{{SUMMARY_SECTION}}/g, summary).replace(/{{META_DESCRIPTION}}/g, article.summary.content.substring(0, 160)).replace(/{{JSON_LD}}/g, jsonLD).replace(/{{HEADLINE}}/g, article.title).replace(/{{BYLINE_URL}}/g, authorUrl).replace(/{{BYLINE_NAME}}/g, authorName).replace(/{{DATE}}/g, currentDate).replace(/{{READ_TIME}}/g, readTime).replace(/{{LEAD_IMAGE_URL}}/g, leadImageUrl).replace(/{{LEAD_IMAGE_ALT}}/g, article.title).replace(/{{ABOUT_COMPANY_TEXT}}/g, aboutCompanyText).replace(/{{ABOUT_COMPANY_TITLE}}/g, aboutCompanyTitle).replace(/{{SOCIAL_LINKS}}/g, socialLinks).replace(/{{TOC_SECTION}}/g, toc).replace(/{{BODY_CONTENT}}/g, bodyContent).replace(/{{KEY_TAKEAWAYS}}/g, keyTakeaways).replace(/{{REFERENCES}}/g, references);
  // Inject CSS (including custom styles)
  html = injectCSS(html, domain, pairsData, customStyles);
  return html;
}
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  // Parse request body once and store for error handling
  let task_id = null;
  let content_plan_outline_guid = null;
  let rich_json = null;
  try {
    try {
      const requestBody = await req.json();
      task_id = requestBody.task_id || null;
      content_plan_outline_guid = requestBody.content_plan_outline_guid || null;
      rich_json = requestBody.rich_json || null;
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return new Response(JSON.stringify({
        error: 'Invalid request body',
        details: parseError.message
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    // Update status: starting HTML conversion
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'converting_json_to_html');
    let articleJson;
    let clientDomain = null;
    let heroImageUrl = null;
    // If rich_json is provided directly, use it
    if (rich_json) {
      articleJson = rich_json;
    } else {
      // Validate that at least one identifier is provided
      if (!task_id && !content_plan_outline_guid) {
        return new Response(JSON.stringify({
          error: 'Either task_id, content_plan_outline_guid, or rich_json must be provided'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      // Fetch client_domain and hero_image_url from tasks table
      let query = supabaseClient.from('tasks').select('client_domain, hero_image_url');
      if (task_id) {
        query = query.eq('task_id', task_id);
      } else if (content_plan_outline_guid) {
        query = query.eq('content_plan_outline_guid', content_plan_outline_guid);
      }
      const { data: taskDataArray, error: taskError } = await query.order('created_at', {
        ascending: false
      }).limit(1);
      if (taskDataArray && taskDataArray.length > 0) {
        const taskData = taskDataArray[0];
        clientDomain = taskData?.client_domain || null;
        heroImageUrl = taskData?.hero_image_url || null;
        console.log(`Found client_domain: ${clientDomain}`);
        if (heroImageUrl) {
          console.log(`Found hero_image_url: ${heroImageUrl}`);
        }
      } else if (taskError) {
        console.warn(`Warning: Error fetching task (will continue without client_domain/hero_image): ${taskError.message}`);
      } else {
        console.warn(`Warning: No task found for ${task_id ? `task_id: ${task_id}` : `content_plan_outline_guid: ${content_plan_outline_guid}`} (will continue without client_domain/hero_image)`);
      }
      // Update status: fetching JSON
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'fetching_json');
      // Call the markdown-to-rich-json function to get the JSON
      const markdownToJsonUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/markdown-to-rich-json`;
      // Add timeout to prevent hanging (5 minutes max)
      const timeoutMs = 5 * 60 * 1000; // 5 minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(()=>controller.abort(), timeoutMs);
      try {
        const markdownResponse = await fetch(markdownToJsonUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            task_id,
            content_plan_outline_guid
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!markdownResponse.ok) {
          let errorData;
          try {
            errorData = await markdownResponse.json();
          } catch  {
            errorData = {
              message: `HTTP ${markdownResponse.status}: ${markdownResponse.statusText}`
            };
          }
          await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'html_generation_failed');
          return new Response(JSON.stringify({
            error: 'Failed to convert markdown to rich JSON',
            details: errorData
          }), {
            status: markdownResponse.status,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
        articleJson = await markdownResponse.json();
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error('Error calling markdown-to-rich-json:', fetchError);
        await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'html_generation_failed');
        return new Response(JSON.stringify({
          error: 'Failed to call markdown-to-rich-json function',
          details: fetchError.message || 'Request timeout or network error'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
    }
    // Update status: fetching pairs data
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'fetching_pairs_data');
    // Fetch pairs data from API if we have a client_domain
    let pairsData = null;
    if (clientDomain) {
      try {
        const { data, error } = await supabaseClient.from('pairs').select('*').eq("domain", clientDomain);
        if (data) {
          pairsData = data.reduce((prev, curr)=>{
            return {
              ...prev,
              [curr.key]: curr.value
            };
          }, {});
          console.log(`Fetched pairs data for ${clientDomain}`);
          console.log(`  - HTML_Post_Template: ${pairsData?.HTML_Post_Template ? 'YES' : 'NO'}`);
          console.log(`  - post_style_tag_main: ${pairsData?.post_style_tag_main ? 'YES' : 'NO'}`);
          console.log(`  - synopsis: ${pairsData?.synopsis ? pairsData.synopsis.length + ' chars' : 'NO'}`);
          console.log(`  - callout_left_cta_dest_url: ${pairsData?.callout_left_cta_dest_url || 'NOT SET (using default)'}`);
          console.log(`  - callout_left_cta_anchor_text: ${pairsData?.callout_left_cta_anchor_text || 'NOT SET (using default)'}`);
          console.log(`  - callout_right_cta_dest_url: ${pairsData?.callout_right_cta_dest_url || 'NOT SET (using default)'}`);
          console.log(`  - callout_right_cta_anchor_text: ${pairsData?.callout_right_cta_anchor_text || 'NOT SET (using default)'}`);
        } else {
          console.log(`Failed to fetch pairs data:`, error);
        }
      } catch (error) {
        console.error('Error fetching pairs data:', error);
      // Continue without pairs data
      }
    }
    // Update status: fetching template
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'fetching_template');
    // Fetch the default HTML template (we always need this as base structure)
    console.log('Fetching default template from Supabase Storage');
    const templateUrl = 'https://jsypctdhynsdqrfifvdh.supabase.co/storage/v1/object/public/cp-downloads/mrb-template.html';
    let defaultTemplate;
    try {
      const templateResponse = await fetch(templateUrl);
      if (!templateResponse.ok) {
        throw new Error(`Failed to fetch template: ${templateResponse.status}`);
      }
      defaultTemplate = await templateResponse.text();
    } catch (error) {
      console.error('Error fetching template:', error);
      return new Response(JSON.stringify({
        error: 'Failed to fetch HTML template',
        details: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Decide which template to use
    let template;
    let customStyles = '';
    if (pairsData?.HTML_Post_Template) {
      console.log(`Found custom HTML_Post_Template for ${clientDomain}`);

      // Extract any <style> tags from custom template (head or body)
      const styleMatches = pairsData.HTML_Post_Template.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
      if (styleMatches) {
        customStyles = styleMatches.join('\n');
        console.log(`  - Found ${styleMatches.length} custom <style> block(s)`);
      }

      // Validate that the custom template has required placeholders
      const validation = validateCustomTemplate(pairsData.HTML_Post_Template);

      if (validation.isValid) {
        console.log(`  - Custom template validation passed - using custom template`);
        template = pairsData.HTML_Post_Template;

        // Log any missing recommended placeholders as warnings
        if (validation.missingRecommended.length > 0) {
          console.log(`  - Warning: Custom template missing recommended placeholders:`);
          validation.missingRecommended.forEach(placeholder => {
            console.log(`    * ${placeholder}`);
          });
        }
      } else {
        console.log(`  - Custom template validation failed - missing required placeholders:`);
        validation.missingCritical.forEach(placeholder => {
          console.log(`    * ${placeholder}`);
        });
        console.log(`  - Falling back to default template with custom CSS`);
        template = defaultTemplate;
      }
    } else {
      console.log('No custom template found - using default template');
      template = defaultTemplate;
    }
    // Update status: rendering HTML
    await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'rendering_html');
    // Render the article
    try {
      const renderedHTML = renderToHTML(articleJson, template, clientDomain || '', pairsData, customStyles, heroImageUrl);
      // Upload HTML to Supabase Storage and get public URL
      let htmlLink = null;
      let guidToUse = null;
      if (task_id) {
        guidToUse = task_id;
      } else if (content_plan_outline_guid && !rich_json) {
        // Get task_id from content_plan_outline_guid if we don't have task_id
        const { data: taskDataArray } = await supabaseClient.from('tasks').select('task_id').eq('content_plan_outline_guid', content_plan_outline_guid).order('created_at', {
          ascending: false
        }).limit(1);
        if (taskDataArray && taskDataArray.length > 0 && taskDataArray[0]?.task_id) {
          guidToUse = taskDataArray[0].task_id;
        }
      }
      // Upload to storage if we have a guid and domain
      if (guidToUse && clientDomain) {
        // Update status: uploading to storage
        await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'uploading_html_to_storage');
        try {
          const filePath = `blogs/${clientDomain}/${guidToUse}.html`;
          console.log(`Uploading HTML to storage: ${filePath}`);
          const { error: uploadError } = await supabaseClient.storage.from('blogs').upload(filePath, renderedHTML, {
            contentType: 'text/html',
            upsert: true // Overwrite if exists
          });
          if (uploadError) {
            console.error(`Error uploading HTML to storage:`, uploadError);
          } else {
            // Get public URL
            const { data: { publicUrl } } = supabaseClient.storage.from('blogs').getPublicUrl(filePath);
            htmlLink = publicUrl;
            console.log(`HTML uploaded successfully. Public URL: ${publicUrl}`);
          }
        } catch (storageError) {
          console.error(`Storage upload error:`, storageError);
        // Continue without storage URL
        }
      }
      // Prepare update data
      const updateData = {
        post_html: renderedHTML,
        content: renderedHTML // Update content field with HTML
      };
      // Add html_link if we have it
      if (htmlLink) {
        updateData.html_link = htmlLink;
        updateData.supabase_html_url = htmlLink; // Also update supabase_html_url
      }
      // Update status: saving HTML
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'saving_html');
      // Save to tasks table if task_id or content_plan_outline_guid was provided
      if (task_id) {
        const { error: updateError } = await supabaseClient.from('tasks').update(updateData).eq('task_id', task_id);
        if (updateError) {
          console.error('Error saving post_html/content/html_link to tasks:', updateError);
        // Don't fail the request, just log the error
        } else {
          console.log(`Saved post_html, content, html_link, and supabase_html_url to tasks table for task_id: ${task_id}`);
          if (htmlLink) {
            console.log(`  html_link: ${htmlLink}`);
            console.log(`  supabase_html_url: ${htmlLink}`);
          }
        }
      } else if (content_plan_outline_guid && !rich_json) {
        // Only save if we fetched from database (not if rich_json was passed directly)
        const { error: updateError } = await supabaseClient.from('tasks').update(updateData).eq('content_plan_outline_guid', content_plan_outline_guid);
        if (updateError) {
          console.error('Error saving post_html/content/html_link to tasks:', updateError);
        } else {
          console.log(`Saved post_html, content, html_link, and supabase_html_url to tasks table for outline_guid: ${content_plan_outline_guid}`);
          if (htmlLink) {
            console.log(`  html_link: ${htmlLink}`);
            console.log(`  supabase_html_url: ${htmlLink}`);
          }
        }
      }
      // Update status: HTML generation complete
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'Completed');
      return new Response(renderedHTML, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    } catch (error) {
      console.error('Error rendering HTML:', error);
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'html_generation_failed');
      return new Response(JSON.stringify({
        error: 'Failed to render HTML',
        details: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    console.error('Error in render-rich-json-to-html function:', error);
    // Try to update status even if we're in the outer catch block
    try {
      const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      await updateTaskStatus(supabaseClient, task_id, content_plan_outline_guid, 'html_generation_failed');
    } catch (statusError) {
      console.error('Failed to update status on error:', statusError);
    }
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
