// supabase/functions/generate-hero-image-prompt/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'
import Anthropic from 'npm:@anthropic-ai/sdk';
import TurndownService from 'npm:turndown';

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { content_plan_outline_guid, use_unedited_content = false } = await req.json()
    
    if (!content_plan_outline_guid) {
      return new Response(JSON.stringify({ error: 'content_plan_outline_guid is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Generating hero image prompt for content plan outline GUID: ${content_plan_outline_guid}`)
    console.log(`Using unedited_content: ${use_unedited_content}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get content from the tasks table
    const { data: taskDataArray, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (taskError || !taskDataArray || taskDataArray.length === 0) {
      console.error('Error fetching task data:', taskError);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch task: ${taskError?.message || 'Task not found'}` 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const taskData = taskDataArray[0];
    
    // Extract the content and client domain based on the flag
    const clientDomain = taskData.client_domain;
    let markdownContent: string;
    
    if (use_unedited_content) {
      // Use unedited_content which is already markdown
      const uneditedContent = taskData.unedited_content;
      
      if (!uneditedContent) {
        console.error('No unedited_content available to generate hero image prompt');
        return new Response(JSON.stringify({ 
          error: 'No unedited_content available in the task' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      markdownContent = uneditedContent;
      console.log(`Using unedited_content (already markdown) (${markdownContent.length} characters)`);
    } else {
      // Use content which is HTML, convert to markdown
      const htmlContent = taskData.content;
      
      if (!htmlContent) {
        console.error('No content available to generate hero image prompt');
        return new Response(JSON.stringify({ 
          error: 'No content available in the task' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Convert HTML to Markdown
      const turndownService = new TurndownService();
      markdownContent = turndownService.turndown(htmlContent);
      console.log(`Converted HTML to Markdown (${markdownContent.length} characters)`);
    }
    
    // Check for custom hero_image_base_prompt and aspect_ratio in pairs table
    let customBasePrompt = null;
    let customAspectRatio = "16:9"; // Default aspect ratio
    
    if (clientDomain) {
      console.log(`Checking for custom settings for domain: ${clientDomain}`);
      
      // Fetch custom base prompt
      const { data: basePromptData } = await supabase
        .from('pairs')
        .select('value')
        .eq('domain', clientDomain)
        .eq('key', 'hero_image_base_prompt')
        .single();
      
      if (basePromptData && basePromptData.value) {
        customBasePrompt = basePromptData.value;
        console.log(`Found custom base prompt for ${clientDomain}: ${basePromptData.value.substring(0, 100)}...`);
      } else {
        console.log(`No custom base prompt found for ${clientDomain}, using default templates`);
      }
      
      // Fetch custom aspect ratio - handle duplicates by taking the first one
      const { data: aspectRatioData } = await supabase
        .from('pairs')
        .select('value')
        .eq('domain', clientDomain)
        .eq('key', 'hero_image_aspect_ratio')
        .limit(1);
      
      if (aspectRatioData && aspectRatioData.length > 0 && aspectRatioData[0].value) {
        customAspectRatio = aspectRatioData[0].value;
        console.log(`Found custom aspect ratio for ${clientDomain}: ${customAspectRatio}`);
      } else {
        console.log(`No custom aspect ratio found for ${clientDomain}, using default 16:9`);
      }
    }
    
    // Prepare the prompt for hero image prompt generation
    // If custom base prompt exists, incorporate it into the instructions
    const promptText = customBasePrompt 
      ? `You are an expert at creating image generation prompts for Google Gemini 2.5 Flash Image Generation. Your task is to analyze a blog post and create a sophisticated, narrative-style prompt for a hero image that will appear at the top of the article.

IMPORTANT: The client has provided a custom base prompt that should influence the style and approach of all generated images:

<custom_base_prompt>
${customBasePrompt}
</custom_base_prompt>

Please incorporate the style, themes, and requirements from the custom base prompt while following these guidelines:

CRITICAL PRINCIPLE: Describe the scene, don't just list keywords. Use narrative, descriptive paragraphs that paint a complete picture. The model excels at understanding natural language descriptions.

Here is the blog post content to analyze:

<blog_post>
${markdownContent}
</blog_post>

STEP 1: ANALYZE THE ARTICLE
- Identify the main topic, theme, and emotional tone
- Note any visual metaphors or imagery mentioned
- Determine the target audience and appropriate style
- Consider whether the content is: technical, lifestyle, business, health, educational, inspirational, or news

STEP 2: SELECT THE APPROPRIATE STYLE TEMPLATE

Based on the article's content and tone, choose ONE of these templates and customize it:

FOR PROFESSIONAL/BUSINESS/TECHNICAL ARTICLES:
"A photorealistic wide-angle shot of [subject/scene], set in [environment]. The scene is illuminated by soft, professional studio lighting creating a clean, corporate atmosphere. Captured with a high-end DSLR using a 24mm lens, emphasizing sharp details and professional polish. Significant negative space in the [upper third/left side] for text overlay. The composition uses the rule of thirds with the main subject positioned [location]. Ultra-realistic with crisp focus throughout. ${customAspectRatio} aspect ratio."

FOR LIFESTYLE/HEALTH/WELLNESS ARTICLES:
"A bright, airy photorealistic image featuring [subject/scene] in a [natural/indoor setting]. Natural daylight streams through, creating soft shadows and a warm, inviting mood. Shot from a slightly elevated angle with a 50mm lens for intimate yet uncluttered composition. Deliberate negative space occupies [percentage] of the frame for headline placement. Colors are soft and harmonious with a [color palette description]. High resolution with shallow depth of field focusing on [key element]. ${customAspectRatio} aspect ratio."

FOR INSPIRATIONAL/MOTIVATIONAL CONTENT:
"A cinematic, uplifting scene depicting [metaphorical representation of the concept]. Golden hour lighting bathes the scene in warm, aspirational tones. Captured from a low angle to create a sense of grandeur and possibility. The composition features dramatic negative space in the [location] with the main subject as a powerful focal point. Atmospheric perspective adds depth with [foreground/background elements]. Photorealistic with enhanced color vibrancy. ${customAspectRatio} aspect ratio."

FOR EDUCATIONAL/HOW-TO ARTICLES:
"A clean, minimalist composition featuring [relevant objects/tools/concepts] arranged in an organized, visually pleasing manner on a [surface description]. Bright, even lighting eliminates harsh shadows, creating perfect clarity. Shot from directly above (flat lay) or at a 45-degree angle for dimensional interest. Substantial negative space surrounds the subjects for easy text integration. Sharp focus throughout with high contrast for visual clarity. Modern, professional aesthetic. ${customAspectRatio} aspect ratio."

FOR NEWS/CURRENT EVENTS:
"A photojournalistic wide shot capturing [scene/situation], conveying [emotion/atmosphere]. Natural lighting conditions create authentic mood and atmosphere. Shot with a 35mm lens for documentary-style realism. The composition balances visual interest with generous negative space for headlines. High dynamic range preserves detail in all areas. Candid, unstaged feeling while maintaining professional quality. ${customAspectRatio} aspect ratio."

FOR ABSTRACT/CONCEPTUAL TOPICS:
"A sophisticated, minimalist composition using [abstract visual elements/metaphors] to represent [concept]. Dramatic lighting creates strong contrast between elements and negative space. The design emphasizes vast empty space (70% of frame) with a single powerful focal element positioned according to golden ratio principles. Clean, modern aesthetic with [color scheme]. Ultra-high resolution with perfect geometric precision. ${customAspectRatio} aspect ratio."

STEP 3: CUSTOMIZE YOUR CHOSEN TEMPLATE
- Replace bracketed placeholders with specific, detailed descriptions
- Add 2-3 sentences of additional scene-setting details
- Include specific mood, atmosphere, and emotional tone descriptions
- Describe lighting in photographic terms (three-point, softbox, natural, golden hour, etc.)
- Mention textures, materials, and fine details
- Consider where text overlays will go and ensure adequate negative space

IMPORTANT GUIDELINES:
- NEVER request text, letters, or words in the image
- Always specify "${customAspectRatio} aspect ratio" for all hero images
- Use photography terminology for photorealistic styles
- Be hyper-specific about details, colors, and composition
- Describe the complete scene as a cohesive narrative
- Include camera/lens details for photorealistic images
- Specify lighting setup and mood
- Ensure 30-50% negative space for text overlays
- Focus on emotional resonance with the article's message

Generate a single, cohesive paragraph describing the complete scene. Write your final prompt inside <image_prompt> tags. Do not include any explanation or meta-commentary.`
      : `You are an expert at creating image generation prompts for Google Gemini 2.5 Flash Image Generation. Your task is to analyze a blog post and create a sophisticated, narrative-style prompt for a hero image that will appear at the top of the article.

CRITICAL PRINCIPLE: Describe the scene, don't just list keywords. Use narrative, descriptive paragraphs that paint a complete picture. The model excels at understanding natural language descriptions.

Here is the blog post content to analyze:

<blog_post>
${markdownContent}
</blog_post>

STEP 1: ANALYZE THE ARTICLE
- Identify the main topic, theme, and emotional tone
- Note any visual metaphors or imagery mentioned
- Determine the target audience and appropriate style
- Consider whether the content is: technical, lifestyle, business, health, educational, inspirational, or news

STEP 2: SELECT THE APPROPRIATE STYLE TEMPLATE

Based on the article's content and tone, choose ONE of these templates and customize it:

FOR PROFESSIONAL/BUSINESS/TECHNICAL ARTICLES:
"A photorealistic wide-angle shot of [subject/scene], set in [environment]. The scene is illuminated by soft, professional studio lighting creating a clean, corporate atmosphere. Captured with a high-end DSLR using a 24mm lens, emphasizing sharp details and professional polish. Significant negative space in the [upper third/left side] for text overlay. The composition uses the rule of thirds with the main subject positioned [location]. Ultra-realistic with crisp focus throughout. ${customAspectRatio} aspect ratio."

FOR LIFESTYLE/HEALTH/WELLNESS ARTICLES:
"A bright, airy photorealistic image featuring [subject/scene] in a [natural/indoor setting]. Natural daylight streams through, creating soft shadows and a warm, inviting mood. Shot from a slightly elevated angle with a 50mm lens for intimate yet uncluttered composition. Deliberate negative space occupies [percentage] of the frame for headline placement. Colors are soft and harmonious with a [color palette description]. High resolution with shallow depth of field focusing on [key element]. ${customAspectRatio} aspect ratio."

FOR INSPIRATIONAL/MOTIVATIONAL CONTENT:
"A cinematic, uplifting scene depicting [metaphorical representation of the concept]. Golden hour lighting bathes the scene in warm, aspirational tones. Captured from a low angle to create a sense of grandeur and possibility. The composition features dramatic negative space in the [location] with the main subject as a powerful focal point. Atmospheric perspective adds depth with [foreground/background elements]. Photorealistic with enhanced color vibrancy. ${customAspectRatio} aspect ratio."

FOR EDUCATIONAL/HOW-TO ARTICLES:
"A clean, minimalist composition featuring [relevant objects/tools/concepts] arranged in an organized, visually pleasing manner on a [surface description]. Bright, even lighting eliminates harsh shadows, creating perfect clarity. Shot from directly above (flat lay) or at a 45-degree angle for dimensional interest. Substantial negative space surrounds the subjects for easy text integration. Sharp focus throughout with high contrast for visual clarity. Modern, professional aesthetic. ${customAspectRatio} aspect ratio."

FOR NEWS/CURRENT EVENTS:
"A photojournalistic wide shot capturing [scene/situation], conveying [emotion/atmosphere]. Natural lighting conditions create authentic mood and atmosphere. Shot with a 35mm lens for documentary-style realism. The composition balances visual interest with generous negative space for headlines. High dynamic range preserves detail in all areas. Candid, unstaged feeling while maintaining professional quality. ${customAspectRatio} aspect ratio."

FOR ABSTRACT/CONCEPTUAL TOPICS:
"A sophisticated, minimalist composition using [abstract visual elements/metaphors] to represent [concept]. Dramatic lighting creates strong contrast between elements and negative space. The design emphasizes vast empty space (70% of frame) with a single powerful focal element positioned according to golden ratio principles. Clean, modern aesthetic with [color scheme]. Ultra-high resolution with perfect geometric precision. ${customAspectRatio} aspect ratio."

STEP 3: CUSTOMIZE YOUR CHOSEN TEMPLATE
- Replace bracketed placeholders with specific, detailed descriptions
- Add 2-3 sentences of additional scene-setting details
- Include specific mood, atmosphere, and emotional tone descriptions
- Describe lighting in photographic terms (three-point, softbox, natural, golden hour, etc.)
- Mention textures, materials, and fine details
- Consider where text overlays will go and ensure adequate negative space

IMPORTANT GUIDELINES:
- NEVER request text, letters, or words in the image
- Always specify "${customAspectRatio} aspect ratio" for all hero images
- Use photography terminology for photorealistic styles
- Be hyper-specific about details, colors, and composition
- Describe the complete scene as a cohesive narrative
- Include camera/lens details for photorealistic images
- Specify lighting setup and mood
- Ensure 30-50% negative space for text overlays
- Focus on emotional resonance with the article's message

Generate a single, cohesive paragraph describing the complete scene. Write your final prompt inside <image_prompt> tags. Do not include any explanation or meta-commentary.`;

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '',
    });
    
    console.log('Generating hero image prompt with Claude using streaming...');
    
    // Generate the hero image prompt with Claude using streaming
    let fullContent = '';
    let thinking = null;
    let textContent = '';
    
    try {
      // Create a streaming request
      const stream = await anthropic.beta.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 60000,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: promptText
          }
        ],
        thinking: {
          type: "enabled",
          budget_tokens: 25000
        },
        betas: ["output-128k-2025-02-19"]
      });
      
      // Collect streamed chunks
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.text) {
          textContent += chunk.delta.text;
        }
      }
      
      // Wait for the final message to ensure we have all content
      const finalMessage = await stream.finalMessage();
      console.log('Received final message from stream');
      
      if (finalMessage) {
        console.log(`Final message content types: ${finalMessage.content ? finalMessage.content.map(c => c.type).join(', ') : 'No content array'}`);
      }
      
      // Extract thinking and text content from the final message
      if (finalMessage && finalMessage.content) {
        for (const contentBlock of finalMessage.content) {
          console.log(`Processing content block of type: ${contentBlock.type}`);
          
          if (contentBlock.type === 'thinking' && contentBlock.thinking) {
            thinking = contentBlock.thinking;
            console.log('Extracted thinking content');
          } else if (contentBlock.type === 'text') {
            fullContent = contentBlock.text;
            console.log(`Extracted final text content (${contentBlock.text.length} chars)`);
          }
        }
      }
      
      // If we didn't get the full content from the final message, use what we collected during streaming
      if (!fullContent && textContent) {
        console.log('Using content collected during streaming');
        fullContent = textContent;
      }
      
      console.log('Hero image prompt generation complete');
      console.log(`Response length: ${fullContent.length} characters`);
    } catch (streamError) {
      console.error('Error during streaming:', streamError);
      throw new Error(`Error during streaming response: ${streamError.message}`);
    }
    
    // Extract just the image prompt content between the tags
    let imagePrompt = fullContent;
    const imagePromptMatch = fullContent.match(/<image_prompt>([\s\S]*?)<\/image_prompt>/i);
    
    if (imagePromptMatch && imagePromptMatch[1]) {
      imagePrompt = imagePromptMatch[1].trim();
      console.log(`Extracted image prompt: ${imagePrompt.length} characters`);
    } else {
      console.log('Image prompt tags not found, using full response');
    }
    
    const thinkingText = typeof thinking === 'string'
      ? thinking
      : thinking
        ? JSON.stringify(thinking)
        : null;

    // Save the hero image prompt to the database
    const { data: saveData, error: saveError } = await supabase
      .from('hero_image_prompts')
      .insert({
        content_plan_outline_guid,
        image_prompt: imagePrompt,
        thinking: thinkingText,
        source_content_length: markdownContent.length,
        task_id: taskData.task_id,
        custom_base_prompt: customBasePrompt,
        aspect_ratio: customAspectRatio
      })
      .select('id')
      .single();
    
    if (saveError) {
      console.error('Error saving hero image prompt:', saveError);
      
      return new Response(JSON.stringify({ 
        content_plan_outline_guid,
        image_prompt: imagePrompt,
        thinking: thinking,
        save_status: {
          success: false,
          message: `Error saving hero image prompt: ${saveError.message}`
        }
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    console.log('Hero image prompt saved successfully:', saveData);
    
    // Also update the task with all hero image data directly
    // Status changes to 'Prompt_Ready' which will trigger image generation
    const heroImageStatus = 'Prompt_Ready';
    const heroImageTimestamp = new Date().toISOString();

    const updatePayload = {
      hero_image_prompt_id: saveData.id,
      hero_image_prompt: imagePrompt,
      hero_image_thinking: thinkingText,
      hero_image_created_at: heroImageTimestamp,
      hero_image_status: heroImageStatus,
      updated_at: heroImageTimestamp
    };

    let { data: updatedTasks, error: updateError } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('task_id', taskData.task_id)
      .select('task_id');

    let updatedTaskRecord = Array.isArray(updatedTasks) ? updatedTasks[0] : null;

    if ((!updatedTaskRecord || updateError) && content_plan_outline_guid) {
      console.warn('Primary task update by task_id failed, retrying with content_plan_outline_guid', {
        taskId: taskData.task_id,
        contentPlanOutlineGuid: content_plan_outline_guid,
        updateError
      });

      ({ data: updatedTasks, error: updateError } = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .select('task_id'));

      updatedTaskRecord = Array.isArray(updatedTasks) ? updatedTasks[0] : null;
    }

    if (updateError || !updatedTaskRecord) {
      console.error('Error updating task with hero image prompt', {
        taskIdTried: taskData.task_id,
        contentPlanOutlineGuid: content_plan_outline_guid,
        updateError
      });

      return new Response(JSON.stringify({
        content_plan_outline_guid,
        image_prompt: imagePrompt,
        thinking: thinkingText,
        save_status: {
          success: true,
          message: 'Hero image prompt saved but task update failed',
          hero_image_prompt_id: saveData.id
        },
        task_update_status: {
          success: false,
          message: updateError?.message || 'No matching task updated'
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }

    // Return the hero image prompt
    return new Response(JSON.stringify({ 
      content_plan_outline_guid,
      image_prompt: imagePrompt,
      thinking: thinkingText,
      content_source: use_unedited_content ? 'unedited_content' : 'content',
      custom_base_prompt_used: !!customBasePrompt,
      aspect_ratio: customAspectRatio,
      save_status: {
        success: true,
        message: 'Hero image prompt saved successfully',
        hero_image_prompt_id: saveData.id
      },
      task_update_status: {
        success: true,
        message: 'Task updated with hero image prompt metadata'
      }
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error generating hero image prompt:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to generate hero image prompt: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
