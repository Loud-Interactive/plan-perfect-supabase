import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * Get Google access token using service account credentials
 */
async function getGoogleAccessToken(): Promise<string> {
  const SERVICE_ACCOUNT_B64 = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  
  if (!SERVICE_ACCOUNT_B64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable not set. Please provide service account credentials.');
  }

  // Decode base64 service account JSON
  const serviceAccount = JSON.parse(
    atob(SERVICE_ACCOUNT_B64)
  ) as ServiceAccount;

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  const payload = btoa(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/documents.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const message = `${header}.${payload}`;
  
  // Remove PEM headers and whitespace from private key, then decode base64
  const privateKeyBase64 = serviceAccount.private_key
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  
  // Convert base64 string to Uint8Array using atob
  const binaryString = atob(privateKeyBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const keyBuffer = bytes.buffer;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureArray = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(message)
  );

  const signature = btoa(
    String.fromCharCode(...new Uint8Array(signatureArray))
  ).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = `${message}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get Google access token: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.access_token as string;
}

/**
 * Extract document ID from Google Doc URL
 */
function extractDocumentId(url: string): string {
  // Handle various Google Doc URL formats:
  // https://docs.google.com/document/d/DOCUMENT_ID/edit
  // https://docs.google.com/document/d/DOCUMENT_ID
  // https://docs.google.com/document/d/DOCUMENT_ID/edit#gid=0
  
  const match = url.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error(`Invalid Google Doc URL format: ${url}`);
  }
  return match[1];
}

/**
 * Fetch Google Doc content using Google Docs API
 */
async function fetchGoogleDocContent(documentId: string, accessToken: string): Promise<any> {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Docs API error: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Convert Google Docs API response to markdown
 */
function convertGoogleDocToMarkdown(doc: any): string {
  let markdown = '';
  const body = doc.body?.content || [];

  // Extract title from document title
  if (doc.title) {
    markdown += `# ${doc.title}\n\n`;
  }

  // Process each structural element
  for (const element of body) {
    if (element.paragraph) {
      markdown += convertParagraphToMarkdown(element.paragraph);
    } else if (element.table) {
      markdown += convertTableToMarkdown(element.table);
    } else if (element.sectionBreak) {
      markdown += '\n---\n\n';
    }
  }

  return markdown.trim();
}

/**
 * Convert a paragraph element to markdown
 */
function convertParagraphToMarkdown(paragraph: any): string {
  const elements = paragraph.elements || [];
  let result = '';
  
  for (const element of elements) {
    if (element.textRun) {
      const textRun = element.textRun;
      let text = textRun.content || '';
      
      // Apply text formatting
      if (textRun.textStyle) {
        const style = textRun.textStyle;
        if (style.bold) text = `**${text}**`;
        if (style.italic) text = `*${text}*`;
        if (style.underline) text = `<u>${text}</u>`;
      }
      
      result += text;
    }
  }

  // Determine heading level based on paragraph style
  const paragraphStyle = paragraph.paragraphStyle;
  if (paragraphStyle?.namedStyleType) {
    const styleType = paragraphStyle.namedStyleType;
    if (styleType === 'HEADING_1') {
      return `# ${result}\n\n`;
    } else if (styleType === 'HEADING_2') {
      return `## ${result}\n\n`;
    } else if (styleType === 'HEADING_3') {
      return `### ${result}\n\n`;
    } else if (styleType === 'HEADING_4') {
      return `#### ${result}\n\n`;
    } else if (styleType === 'HEADING_5') {
      return `##### ${result}\n\n`;
    } else if (styleType === 'HEADING_6') {
      return `###### ${result}\n\n`;
    }
  }

  // Regular paragraph
  if (result.trim()) {
    return `${result}\n\n`;
  }

  return '';
}

/**
 * Convert a table element to markdown
 */
function convertTableToMarkdown(table: any): string {
  const rows = table.tableRows || [];
  let markdown = '\n';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.tableCells || [];
    const cellContents: string[] = [];

    for (const cell of cells) {
      let cellText = '';
      const content = cell.content || [];
      
      for (const element of content) {
        if (element.paragraph) {
          const paragraphText = convertParagraphToMarkdown(element.paragraph).trim();
          cellText += paragraphText.replace(/\n/g, ' ');
        }
      }
      
      cellContents.push(cellText || ' ');
    }

    markdown += '| ' + cellContents.join(' | ') + ' |\n';

    // Add header separator after first row
    if (i === 0) {
      markdown += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
    }
  }

  return markdown + '\n';
}

/**
 * Parses markdown content and converts it to structured JSON format
 * (Same logic as markdown-to-rich-json)
 */
function parseMarkdownToJson(markdown: string) {
  const lines = markdown.split('\n');
  const result: {
    title: string;
    sections: Array<{
      title: string;
      subsections: Array<{
        title: string;
        content: string;
      }>;
    }>;
    references: Array<{
      number: number;
      citation: string;
      url: string;
    }>;
  } = {
    title: '',
    sections: [],
    references: []
  };
  
  let currentSection: typeof result.sections[0] | null = null;
  let currentSubsection: typeof result.sections[0]['subsections'][0] | null = null;
  let inReferences = false;
  let contentBuffer = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Main title (# Title)
    if (line.startsWith('# ') && !result.title) {
      result.title = line.substring(2).trim();
      continue;
    }
    
    // Section title (## Title)
    if (line.startsWith('## ')) {
      // Save previous subsection if exists
      if (currentSubsection && contentBuffer.trim()) {
        currentSubsection.content = contentBuffer.trim();
        contentBuffer = '';
      }
      
      const sectionTitle = line.substring(3).trim();
      
      // Check if this is the References section
      if (sectionTitle === 'References') {
        inReferences = true;
        continue;
      }
      
      // Save previous section
      if (currentSection) {
        result.sections.push(currentSection);
      }
      
      currentSection = {
        title: sectionTitle,
        subsections: []
      };
      currentSubsection = null;
      continue;
    }
    
    // Subsection title (### Title)
    if (line.startsWith('### ')) {
      // Save previous subsection if exists
      if (currentSubsection && contentBuffer.trim()) {
        currentSubsection.content = contentBuffer.trim();
        contentBuffer = '';
      }
      
      currentSubsection = {
        title: line.substring(4).trim(),
        content: ''
      };
      
      if (currentSection) {
        currentSection.subsections.push(currentSubsection);
      }
      continue;
    }
    
    // Parse references
    if (inReferences) {
      // Match pattern: 1. Citation text - [URL](URL)
      const refMatch = line.match(/^(\d+)\.\s+(.+?)\s+-\s+\[([^\]]+)\]\(([^)]+)\)/);
      if (refMatch) {
        result.references.push({
          number: parseInt(refMatch[1]),
          citation: refMatch[2].trim(),
          url: refMatch[4].trim()
        });
      }
      continue;
    }
    
    // Skip empty lines at the start of content
    if (!contentBuffer && !line.trim()) {
      continue;
    }
    
    // Accumulate content for current subsection
    if (currentSubsection && line.trim()) {
      if (contentBuffer) {
        contentBuffer += ' ';
      }
      contentBuffer += line.trim();
    }
  }
  
  // Save last subsection
  if (currentSubsection && contentBuffer.trim()) {
    currentSubsection.content = contentBuffer.trim();
  }
  
  // Save last section
  if (currentSection) {
    result.sections.push(currentSection);
  }
  
  return result;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const { task_id, content_plan_outline_guid } = await req.json();

    // Validate that at least one identifier is provided
    if (!task_id && !content_plan_outline_guid) {
      return new Response(
        JSON.stringify({
          error: 'Either task_id or content_plan_outline_guid must be provided'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Fetch the task with google_doc_link
    let query = supabaseClient.from('tasks').select('task_id, google_doc_link, title');
    if (task_id) {
      query = query.eq('task_id', task_id);
    } else if (content_plan_outline_guid) {
      query = query.eq('content_plan_outline_guid', content_plan_outline_guid);
    }

    const { data: taskData, error: fetchError } = await query.single();

    if (fetchError) {
      console.error('Error fetching task:', fetchError);
      return new Response(
        JSON.stringify({
          error: 'Task not found',
          details: fetchError.message
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Check if google_doc_link exists
    if (!taskData.google_doc_link) {
      return new Response(
        JSON.stringify({
          error: 'google_doc_link is null or empty for this task'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate Google Doc URL format
    if (!taskData.google_doc_link.includes('docs.google.com')) {
      return new Response(
        JSON.stringify({
          error: 'Invalid Google Doc URL format'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Processing Google Doc for task: ${taskData.task_id}`);
    console.log(`Google Doc URL: ${taskData.google_doc_link}`);

    // Extract document ID and fetch content
    const documentId = extractDocumentId(taskData.google_doc_link);
    console.log(`Extracted document ID: ${documentId}`);

    // Get Google access token
    const accessToken = await getGoogleAccessToken();
    console.log('Successfully obtained Google access token');

    // Fetch document content
    const docContent = await fetchGoogleDocContent(documentId, accessToken);
    console.log(`Fetched document: ${docContent.title || 'Untitled'}`);

    // Convert to markdown
    const markdown = convertGoogleDocToMarkdown(docContent);
    console.log(`Converted to markdown (${markdown.length} characters)`);

    // Parse markdown to JSON
    const postJson = parseMarkdownToJson(markdown);
    console.log(`Parsed to JSON: ${postJson.sections.length} sections, ${postJson.references.length} references`);

    // Update the tasks table with markdown and JSON
    const { error: updateError } = await supabaseClient
      .from('tasks')
      .update({
        edited_content: markdown,
        post_json: postJson
      })
      .eq('task_id', taskData.task_id);

    if (updateError) {
      console.error('Error updating task:', updateError);
      return new Response(
        JSON.stringify({
          error: 'Failed to update task',
          details: updateError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Successfully updated task ${taskData.task_id} with markdown and JSON`);

    return new Response(
      JSON.stringify({
        success: true,
        task_id: taskData.task_id,
        document_title: docContent.title || 'Untitled',
        markdown_length: markdown.length,
        sections_count: postJson.sections.length,
        references_count: postJson.references.length,
        message: 'Google Doc successfully read and converted to markdown and JSON'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error in google-doc-to-markdown function:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        details: error instanceof Error ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
