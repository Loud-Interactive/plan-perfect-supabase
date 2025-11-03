import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
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
        toc += `          <li>
            <a href="#${subsectionId}">${subsection.heading}</a>
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
 */ function generateCallout(callout, side) {
  if (!callout.text) return '';
  return `<!-- Start: Callout ${side === 'left' ? 'Left' : 'Right'}  -->
<div class="callout callout_${side}">
  <p class="callout_text">
    ${callout.text}
  </p>
  <!-- Start: Callout ${side === 'left' ? 'Left' : 'Right'} CTA -->
  <div class="callout_${side}_cta_button">
    <a class="callout_${side}_cta_dest_url" href="${callout.cta_url}">
      <span class="callout_${side}_cta_anchor_text"> ${callout.cta_text} </span>
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
/**
 * Generate Body Content HTML
 */ function generateBodyContent(article) {
  let html = '';
  let leftCalloutUsed = false;
  let rightCalloutUsed = false;
  article.sections.forEach((section, sectionIdx)=>{
    const sectionId = `Section_${sectionIdx + 1}`;
    html += `\n<h2 id="${sectionId}">
  ${section.heading}
</h2>\n`;
    section.subsections.forEach((subsection, subIdx)=>{
      const subsectionId = `${sectionId}_SubSection_${subIdx + 1}`;
      html += `<h3 id="${subsectionId}">${subsection.heading}</h3>\n`;
      // Insert left callout after first subsection of second section
      if (sectionIdx === 1 && subIdx === 0 && !leftCalloutUsed && article.callouts.left.text) {
        html += '\n' + generateCallout(article.callouts.left, 'left') + '\n\n';
        leftCalloutUsed = true;
      }
      // Insert right callout after first subsection of third section
      if (sectionIdx === 2 && subIdx === 0 && !rightCalloutUsed && article.callouts.right.text) {
        html += '\n' + generateCallout(article.callouts.right, 'right') + '\n\n';
        rightCalloutUsed = true;
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
  return html;
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
      <a href="${ref.url}">${ref.citation}</a>
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
  if (pairsData.facebook_url) {
    html += `<a href="${pairsData.facebook_url}" class="social-link facebook" target="_blank" rel="noopener">Facebook</a>\n      `;
  }
  if (pairsData.twitter_url) {
    html += `<a href="${pairsData.twitter_url}" class="social-link twitter" target="_blank" rel="noopener">Twitter</a>\n      `;
  }
  if (pairsData.linkedin_url) {
    html += `<a href="${pairsData.linkedin_url}" class="social-link linkedin" target="_blank" rel="noopener">LinkedIn</a>\n      `;
  }
  if (pairsData.instagram_url) {
    html += `<a href="${pairsData.instagram_url}" class="social-link instagram" target="_blank" rel="noopener">Instagram</a>\n      `;
  }
  return html.trim();
}
/**
 * Render the rich JSON into the HTML template
 */ function renderToHTML(article, template, domain, pairsData, customStyles = '', heroImageUrl = null) {
  // Generate all sections
  const toc = generateTOC(article);
  const summary = generateSummary(article.summary);
  const bodyContent = generateBodyContent(article);
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
  // Default hero image if none provided
  const leadImageUrl = heroImageUrl || 'https://via.placeholder.com/1200x630';
  // Replace all {{PLACEHOLDER}} patterns in new template format
  let html = template.replace(/{{TITLE_TAG}}/g, article.title).replace(/{{SUMMARY_SECTION}}/g, summary).replace(/{{META_DESCRIPTION}}/g, article.summary.content.substring(0, 160)).replace(/{{JSON_LD}}/g, jsonLD).replace(/{{HEADLINE}}/g, article.title).replace(/{{BYLINE_URL}}/g, '#').replace(/{{BYLINE_NAME}}/g, 'Author').replace(/{{DATE}}/g, currentDate).replace(/{{READ_TIME}}/g, readTime).replace(/{{LEAD_IMAGE_URL}}/g, leadImageUrl).replace(/{{LEAD_IMAGE_ALT}}/g, article.title).replace(/{{ABOUT_COMPANY_TEXT}}/g, aboutCompanyText).replace(/{{SOCIAL_LINKS}}/g, socialLinks).replace(/{{TOC_SECTION}}/g, toc).replace(/{{BODY_CONTENT}}/g, bodyContent).replace(/{{KEY_TAKEAWAYS}}/g, keyTakeaways).replace(/{{REFERENCES}}/g, references);
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
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    const { task_id, content_plan_outline_guid, rich_json } = await req.json();
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
      const { data: taskData, error: taskError } = await query.single();
      if (taskError) {
        console.error('Error fetching task:', taskError);
      } else {
        clientDomain = taskData?.client_domain || null;
        heroImageUrl = taskData?.hero_image_url || null;
        console.log(`Found client_domain: ${clientDomain}`);
        if (heroImageUrl) {
          console.log(`Found hero_image_url: ${heroImageUrl}`);
        }
      }
      // Call the markdown-to-rich-json function to get the JSON
      const markdownToJsonUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/markdown-to-rich-json`;
      const markdownResponse = await fetch(markdownToJsonUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          task_id,
          content_plan_outline_guid
        })
      });
      if (!markdownResponse.ok) {
        const errorData = await markdownResponse.json();
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
    }
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
        } else {
          console.log(`Failed to fetch pairs data:`, error);
        }
      } catch (error) {
        console.error('Error fetching pairs data:', error);
      // Continue without pairs data
      }
    }
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
      // IMPORTANT: Always use default template structure for content rendering
      // Custom templates are used ONLY for CSS/styling, not content structure
      // This ensures renderToHTML always works with predictable placeholders
      console.log(`  - Using default template structure with custom CSS`);
      template = defaultTemplate;
    } else {
      console.log('Using default template');
      template = defaultTemplate;
    }
    // Render the article
    try {
      const renderedHTML = renderToHTML(articleJson, template, clientDomain || '', pairsData, customStyles, heroImageUrl);
      // Save to tasks table if task_id or content_plan_outline_guid was provided
      if (task_id) {
        const { error: updateError } = await supabaseClient.from('tasks').update({
          post_html: renderedHTML
        }).eq('task_id', task_id);
        if (updateError) {
          console.error('Error saving post_html to tasks:', updateError);
        // Don't fail the request, just log the error
        } else {
          console.log(`Saved post_html to tasks table for task_id: ${task_id}`);
        }
      } else if (content_plan_outline_guid && !rich_json) {
        // Only save if we fetched from database (not if rich_json was passed directly)
        const { error: updateError } = await supabaseClient.from('tasks').update({
          post_html: renderedHTML
        }).eq('content_plan_outline_guid', content_plan_outline_guid);
        if (updateError) {
          console.error('Error saving post_html to tasks:', updateError);
        } else {
          console.log(`Saved post_html to tasks table for outline_guid: ${content_plan_outline_guid}`);
        }
      }
      return new Response(renderedHTML, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html'
        }
      });
    } catch (error) {
      console.error('Error rendering HTML:', error);
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
