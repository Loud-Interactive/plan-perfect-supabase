// Supabase Edge Function: synopsis-analyzer
// Description: Runs LLM analysis on crawled content using exact prompts from Python version

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { callModelWithLogging } from "../utils/model-logging.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Log current model being used
const SYNOPSIS_MODEL = Deno.env.get('SYNOPSIS_MODEL') || 'deepseek'
console.log(`[synopsis-analyzer] Using model: ${SYNOPSIS_MODEL}`)

interface AnalyzerRequest {
  job_id: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Store the job_id early to use in error handling
  let jobId: string | null = null

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const requestData: AnalyzerRequest = await req.json()
    jobId = requestData.job_id

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Starting analysis for job ${jobId}`)

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    // Get all completed page tasks
    const { data: pageTasks, error: tasksError } = await supabase
      .from('synopsis_page_tasks')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'completed')

    if (tasksError) {
      throw new Error(`Failed to get page tasks: ${tasksError.message}`)
    }

    if (!pageTasks || pageTasks.length === 0) {
      throw new Error('No completed page tasks found')
    }

    console.log(`Found ${pageTasks.length} completed page tasks`)

    // Combine all content (same logic as Python version)
    const { combinedContent, combinedHtml } = combinePageContent(pageTasks, job.domain)

    // Create all analysis tasks with EXACT prompts from Python version
    const analysisTasks = await createAnalysisTasks(jobId, job.domain, combinedContent, combinedHtml)

    console.log(`Created ${analysisTasks.length} analysis tasks`)

    // Process all analysis tasks in parallel
    await processAnalysisTasks(analysisTasks)

    // Trigger finalizer
    await triggerFinalizer(jobId)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Analysis completed for ${analysisTasks.length} tasks`,
        job_id: jobId,
        analysis_tasks: analysisTasks.length
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-analyzer:', error)
    
    // Update job status to failed using the stored jobId
    if (jobId) {
      await supabase
        .from('synopsis_jobs')
        .update({
          status: 'failed',
          error_message: `Analysis failed: ${error.message}`
        })
        .eq('id', jobId)
    }
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Combine page content (same logic as Python version)
 */
function combinePageContent(pageTasks: any[], domain: string): { combinedContent: string, combinedHtml: string } {
  let combinedContent = ""
  let combinedHtml = ""

  // Token limit check - same as Python (120k tokens)
  const TOKEN_LIMIT = 120000

  for (const task of pageTasks) {
    if (task.markdown_content) {
      const newContent = `URL: ${task.url}\nReadable Content: ${task.markdown_content}\n\n`
      const estimatedTokens = estimateTokens(combinedContent + newContent)
      
      if (estimatedTokens > TOKEN_LIMIT) {
        break
      }
      combinedContent += newContent
    }

    if (task.raw_html) {
      const newHtml = `URL: ${task.url}\nHTML Content: ${task.raw_html}\n\n`
      const estimatedTokens = estimateTokens(combinedHtml + newHtml)
      
      if (estimatedTokens > TOKEN_LIMIT) {
        break
      }
      combinedHtml += newHtml
    }
  }

  return { combinedContent, combinedHtml }
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4)
}

/**
 * Create all analysis tasks with EXACT prompts from Python version
 */
async function createAnalysisTasks(jobId: string, domain: string, combinedContent: string, combinedHtml: string): Promise<any[]> {
  // EXACT PROMPTS FROM PYTHON VERSION - NO CHANGES
  
  const readablePrompt = `Here is the readable content of the top 10 pages for the domain ${domain}, based on this information I want you to give me the synopsis and elevator pitch for this domain.Be sure to use first-person narration in your reply for the elevator pitch. However, ALWAYS use 'we' and 'our' never 'I'. As for the synopsis, always respond in third-person narration for the synopsis. reply with no comments only reply with synopsis and elevator pitch. put them in a json object make sure to use double  "{"synopsis":"your synopsis", "elevator_pitch":"youre elevator pitch","brand_name":"the company brand name"}" - IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON  Here is the content:\n\n${combinedContent} 
\n\n
REMEMBER ONLY THE JSON RESPONSE`

  const htmlPrompt = `Here is the html content of the top 10 pages for the domain ${domain}, based on this information I want you to give me the call to action for this ${domain}, this should be a domain wide CTA no specific to a single page, in a json object you need to give me the anchor text and url of where the CTA should link to. "{"url":"url of call to action","anchor_text":"anchor text to use for cta", "example_link":"full <a> tag example of the link and the achor text", "rationale":"your rationale behind this thinking"}" - IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const brandVoicePrompt = `Analyze the provided blog content from ${domain} and identify the key "
  "characteristics of their voice and tone. Extract the following information based "
  "on your analysis:\n\n"
  "Voice traits\n"
  "Tone\n"
  "Lexicon and vocabulary\n"
  "Language style and sentiment\n"
  "Linguistic style\n"
  "Frequently used phrases or expressions\n\n"
  "Additionally, provide examples from the blog content to support your findings.\n\n"
  "I want you to take the Voice traits, Tone, Lexicon and vocabulary, Language style "
  "and sentiment, Linguistic style & Frequently used phrases or expressions crafting it "
  "in a sentence like the one below, this is our voice prompt. It should be written in "
  "the second person (you)\n\n"
  "Example Voice Prompt:\n"
  "\"You speak bluntly and respectfully but also colorfully. You use a lexicon that any "
  "high school graduate could easily understand. You speak with a positive, inspiring tone. "
  "You aim to empower with your words and make anyone feel like they can do anything. Your "
  "speech is not formal and fancy, it's joyful, quirky, and loose. You never sound fake. "
  "You talk like a best friend, not a teacher. You are smart but not preachy. You communicate "
  "visually through written word with lots of descriptors and adjectives that paint a vivid "
  "image. You are enthusiastic and energetic. You are aspirational yet attainable, in-the-know "
  "yet friendly. You don't overly sell, you let the quality of the product and the products' "
  "roots sell-itself. You are Hedley & Bennett, born in a restaurant kitchen out of the need "
  "for a better working & better-looking apron. You were created by Ellen Bennett, the creative "
  "force behind the brand and a self-taught chef turned entrepreneur. You make aprons and "
  "kitchen gear for both home cooks and the best chefs in the world who have both a passion for "
  "cooking and an eye for design. You made sure every prototype was fretted over by the pickiest "
  "gear nerds and battle-tested in the best kitchens around the world. You have a strong work "
  "ethic and a drive to succeed, which is evident in the growth and success of the company. "
  "You are a leader in the industry, known for your innovative designs, unbridled creativity, "
  "commitment to quality and dedication to your craft.\"\n\n"
  "I want you to respond with this JSON object and this JSON object only no comments, no "
  "explanations.It is important that you ignore an javascript or html errors. Focus on the content that is gear towawrd the users. Ignore headers, footers, advertisements, newsletter sign upsn\n {{"\t\"voice_prompt\": \"<voice prompt you crafted\",\n"
    "\t\"voice_prompt_logic\": \"<the logic you used to determine the voice, along with supporting evidence\",\n"
    "\t\"voice_traits\": \"<voice traits>\",\n"
    "\t\"tone\": \"<tone>\",\n"
    "\t\"lexicon\": \"<Lexicon and vocabulary>\",\n"
    "\t\"lang_style\": \"<Language style and sentiment>\",\n"
    "\t\"ling_style\": \"<Linguistic style>\",\n"
    "\t\"freq_phrases\": \"<Frequently used phrases or expressions>\"\n"}}"
    "I want you to respond with this JSON object and this JSON object only no comments here is the content: ${combinedContent} `

  const companyInformationPrompt = `
  Based on the provided content, extract the following company information and return it in JSON format:
  - Company Logo URL
  - Company Website URL
  - Company Social Media Profiles (URLs for Facebook, Twitter, LinkedIn, Instagram)
  - Company Size (Number of Employees)
  - Company Revenue
  - Company Founding Date
  - Company Legal Structure (e.g., Corporation, LLC, Partnership)
  - Company Certifications or Awards

  Return the information in the following JSON format:
  {
    "logo_url": "",
    "website_url": "",   
    "facebook": "",
    "twitter": "",
    "linkedin": "",
    "instagram": ""
    "company_size": "",
    "company_revenue": "",
    "founding_date": "",
    "legal_structure": "",
    "certifications_awards": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const targetAudiencePrompt = `
  Based on the provided content, identify the target audience for the company and return the information in JSON format:
  - Target Audience Demographics (Age, Gender, Income, Education)
  - Target Audience Psychographics (Interests, Attitudes, Values)

  Return the information in the following JSON format:
  {
      "demographics_age": "",
      "demographics_gender": "",
      "demographics_income": "",
      "demographics_education": "",
      "psychographics_interests": [],
      "psychographics_attitudes": [],
      "psychographics_values": []
    
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const brandIdentityPrompt = `
  Based on the provided content, analyze the company's brand identity and return the information in JSON format:
  - Brand Personality (e.g., Friendly, Professional, Innovative, Reliable)
  - Brand Values
  - Brand Story
  - Unique Selling Proposition (USP)
  - Key Differentiators from Competitors

  Return the information in the following JSON format:
  {
    "brand_personality": [],
    "brand_values": [],
    "brand_story": "",
    "usp": "",
    "key_differentiators": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const contentStrategyPrompt = `
  Based on the provided content, identify the company's content strategy and return the information in JSON format:
  - Content Themes or Pillars
  - Preferred Content Formats (e.g., Blog Posts, Videos, Infographics)
  - Preferred Channels for Content Distribution
  - Influencers or Thought Leaders in the Industry
  - Industry Events or Conferences
  - Seasonal or Holiday-related Themes

  Return the information in the following JSON format:
  {
    "content_themes": [],
    "preferred_formats": [],
    "distribution_channels": [],
    "influencers": [],
    "industry_events": [],
    "seasonal_themes": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const communicationGuidelinesPrompt = `
  Based on the provided content, identify the company's communication guidelines and return the information in JSON format:
  - Crisis Communication Plan
  - Corporate Social Responsibility (CSR) Initiatives
  - Press Release Boilerplate
  - Preferred Hashtags
  - Image and Video Guidelines (e.g., Preferred Styles, Dimensions)
  - Call-to-Action (CTA) Guidelines
  - A/B Testing Plans or Results

  Return the information in the following JSON format:
  {
    "crisis_communication_plan": "",
    "csr_initiatives": [],
    "press_release_boilerplate": "",
    "preferred_hashtags": [],
    "image_video_guidelines_image_styles": [],
    "image_video_guidelines_image_dimensions": [],
    "image_video_guidelines_video_styles": [],
    "image_video_guidelines_video_dimensions": []
    "cta_guidelines": "",
    "ab_testing_plans": [],
    "ab_testing_results": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const companyDetailsPrompt = `
  Based on the provided content, extract the following company details and return them in JSON format:
  - Company Name
  - Company AKA (Also Known As)
  - Industry
  - Headquarters Address 1
  - HQ Address 2
  - HQ Address 3
  - HQ City
  - HQ State
  - HQ Postal Code
  - HQ Country
  - Phone Number
  - Mission

  Return the information in the following JSON format:
  {
    "company_name": "",
    "company_aka": "",
    "industry": "",
    "hq_address_1": "",
    "hq_address_2": "",
    "hq_address_3": "",
    "hq_city": "",
    "hq_state": "",
    "hq_postal_code": "",
    "hq_country": "",
    "phone_number": "",
    "mission": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const languagePreferencesPrompt = `
  Based on the provided content, identify the company's language preferences and return them in JSON format:
  - Preferred Language
  - Secondary Language
  - Third Language

  Return the information in the following JSON format:
  {
    "preferred_language": "",
    "secondary_language": "",
    "third_language": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const servicesProductsPrompt = `
  Based on the provided content, list the company's main services and products along with their respective URLs, and return them in JSON format:
  - Service Category 1
  - Service URL 1
  - Service Category 2
  - Service URL 2
  - Service Category 3
  - Service URL 3
  - Product 1
  - Product URL 1
  - Product 2
  - Product URL 2
  - Product 3
  - Product URL 3

  Return the information in the following JSON format:
  {
    "service_1_category": "",
    "service_1_url": "",
    "service_2_category": "",
    "service_2_url": "",
    "service_3_category": "",
    "service_3_url": "",
    "product_1_name": "",
    "product_1_url": "",
    "product_2_name": "",
    "product_2_url": "",
    "product_3_name": "",
    "product_3_url": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const marketFocusBusinessGoalsPrompt = `
  Based on the provided content, identify the company's market focus and business goals, and return them in JSON format:
  - Market Focus (B2B, B2C, B2G, etc.)
  - Business Goals in JSON ARRAY

  Return the information in the following JSON format:
  {
    "market_focus": "",
    "business_goals": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const clientPersonaPrompt = `
  Based on the provided content, describe the company's typical client persona and return it in JSON format.

  Return the information in the following JSON format:
  {
    "client_persona": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const brandVoiceDetailsPrompt = `
  Based on the provided content, identify the following details about the company's brand voice and return them in JSON format:
  - First Person Voice
  - Second Person Voice
  - Third Person Voice

  Return the information in the following JSON format:
  {
    "first_person_voice": "",
    "second_person_voice": "",
    "third_person_voice": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const competitorTopicGuidelinesPrompt = `
  Based on the provided content, list the company's main competitors, their domains, and any topics to avoid. Also, identify the company's political leaning and return all the information in JSON format:
  - Competitor Names in JSON ARRAY
  - Competitor Domains in JSON ARRAY
  - Avoid Topics in JSON ARRAY
  - Political Leaning (Right, Center, Left, Apathetic)

  Return the information in the following JSON format:
  {
    "competitor_names": [],
    "competitor_domains": [],
    "avoid_topics": [],
    "political_leaning": ""
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const trademarkRegistrationGuidelinesPrompt = `
 
Based on the provided content, list any words or phrases that should be trademark marked (™) / (TM) or registered (®) / (R), and return them in JSON format:
- Words to Trademark Mark (™) / (TM)
- Words to Register Mark (®) / (R)

  IT IS IMPORTANT TO NOTE THAT ONLY PHRASES THAT YOU SEE WITH 

  Return the information in the following JSON format:
  {
    "trademark_words": [],
    "registered_words": []
  }
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  const socialMediaContactPrompt = `
  Based on the provided content, extract the company's social media profiles and email contact information. Return the data in JSON format as follows:

  {
    "facebook": "",
    "twitter": "",
    "instagram": "",
    "youtube": "",
    "pinterest": "",
    "tiktok": "",
    "linkedin": "",
    "snapchat": "",
    "reddit": "",
    "tumblr": "",
    "flickr": "",
    "vimeo": "",
    "soundcloud": "",
    "spotify": "",
    "medium": "",
    "quora": "",
    "github": "",
    "behance": "",
    "dribbble": "",
    "vk": "",
    "weibo": "",
    "wechat": "",
    "qq": "",
    "discord": "",
    "twitch": "",
    "telegram": "",
    "whatsapp": "",
    "kik": "",
    "line": "",
    "other_social": []
    "customer_support_email": "",
    "press_inquiries_email": "",
    "partnerships_email": "",
    "investor_relations_email": "",
    "general_inquiries": "",
    "other_email": []
  }

  If a particular social media profile or email contact is not found, leave the corresponding field empty. For any additional social media profiles or email contacts not listed, include them in the "other" array.
  IMPORTANT PROVIDE NO OTHER COMMENTS JUST THE JSON

   IF YOU DO NOT FIND THIS INFORMATION IN THE PROVIDED CONTENT, JUST RETURN THE JSON OBJECT WITH NO COMMENTS.

  Here is the html content:

  ${combinedHtml}
  \n\n
  REMEMBER ONLY THE JSON RESPONSE
  `

  // Create analysis task records
  const analysisTypes = [
    { type: 'synopsis_elevator_pitch', prompt: readablePrompt, content: combinedContent },
    { type: 'call_to_action', prompt: htmlPrompt, content: combinedHtml },
    { type: 'brand_voice', prompt: brandVoicePrompt, content: combinedContent },
    { type: 'company_information', prompt: companyInformationPrompt, content: combinedHtml },
    { type: 'target_audience', prompt: targetAudiencePrompt, content: combinedHtml },
    { type: 'brand_identity', prompt: brandIdentityPrompt, content: combinedHtml },
    { type: 'content_strategy', prompt: contentStrategyPrompt, content: combinedHtml },
    { type: 'communication_guidelines', prompt: communicationGuidelinesPrompt, content: combinedHtml },
    { type: 'company_details', prompt: companyDetailsPrompt, content: combinedHtml },
    { type: 'language_preferences', prompt: languagePreferencesPrompt, content: combinedHtml },
    { type: 'services_products', prompt: servicesProductsPrompt, content: combinedHtml },
    { type: 'market_focus_business_goals', prompt: marketFocusBusinessGoalsPrompt, content: combinedHtml },
    { type: 'client_persona', prompt: clientPersonaPrompt, content: combinedHtml },
    { type: 'brand_voice_details', prompt: brandVoiceDetailsPrompt, content: combinedHtml },
    { type: 'competitor_topic_guidelines', prompt: competitorTopicGuidelinesPrompt, content: combinedHtml },
    { type: 'trademark_registration_guidelines', prompt: trademarkRegistrationGuidelinesPrompt, content: combinedHtml },
    { type: 'social_media_contact', prompt: socialMediaContactPrompt, content: combinedHtml }
  ]

  // Insert all analysis tasks
  const tasksToInsert = analysisTypes.map(task => ({
    job_id: jobId,
    analysis_type: task.type,
    prompt: task.prompt,
    raw_content: task.content,
    status: 'pending'
  }))

  const { data: insertedTasks, error: insertError } = await supabase
    .from('synopsis_analysis_tasks')
    .insert(tasksToInsert)
    .select()

  if (insertError) {
    throw new Error(`Failed to create analysis tasks: ${insertError.message}`)
  }

  return insertedTasks
}

/**
 * Process all analysis tasks in parallel
 */
async function processAnalysisTasks(tasks: any[]): Promise<void> {
  // Process tasks in parallel with some concurrency limit
  const CONCURRENCY_LIMIT = 5
  const chunks = []
  
  for (let i = 0; i < tasks.length; i += CONCURRENCY_LIMIT) {
    chunks.push(tasks.slice(i, i + CONCURRENCY_LIMIT))
  }

  for (const chunk of chunks) {
    const promises = chunk.map(task => processAnalysisTask(task))
    await Promise.allSettled(promises)
  }
}

/**
 * Process a single analysis task
 */
async function processAnalysisTask(task: any): Promise<void> {
  try {
    console.log(`Processing analysis task: ${task.analysis_type}`)

    // Update task status to processing
    await supabase
      .from('synopsis_analysis_tasks')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)

    // Use configured model for analysis with proper logging
    const { response, thinking } = await callModelWithLogging(
      'synopsis-analyzer',
      task.prompt,
      task.job_id, // Use job_id as domain for grouping
      {
        analysis_type: task.analysis_type,
        task_id: task.id
      }
    )

    // Update task with results
    await supabase
      .from('synopsis_analysis_tasks')
      .update({
        status: 'completed',
        llm_response: response,
        thinking_log: thinking,
        completed_at: new Date().toISOString(),
        error_message: null
      })
      .eq('id', task.id)

    console.log(`Completed analysis task: ${task.analysis_type}`)

  } catch (error) {
    console.error(`Error processing analysis task ${task.analysis_type}:`, error)

    // Update task with error
    await supabase
      .from('synopsis_analysis_tasks')
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', task.id)
  }
}


/**
 * Trigger the finalizer
 */
async function triggerFinalizer(jobId: string): Promise<void> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/synopsis-finalizer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId
      })
    })

    if (!response.ok) {
      throw new Error(`Finalizer trigger failed: ${response.status}`)
    }

    console.log(`Successfully triggered finalizer for job ${jobId}`)
  } catch (error) {
    console.error('Error triggering finalizer:', error)
    throw error
  }
}