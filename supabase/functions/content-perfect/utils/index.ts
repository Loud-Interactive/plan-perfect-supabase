// Content Perfect Utility Functions

import { SupabaseClient } from '@supabase/supabase-js';
import { 
  normalizeDomain, 
  stringToBool, 
  getDomainPreferences, 
  getStyleSettings,
  getSchemaSettings, 
  getContentSettings, 
  createClientSynopsis 
} from './preferences';
import {
  markdownToHtml,
  createHtmlDocument,
  addCitationsToHtml,
  addStylesToHtml
} from './markdown';
import {
  generateBasicArticleSchema,
  extractFirstParagraph,
  generateSchemaWithPreferences,
  injectSchemaData
} from './schema';

/**
 * Handles error logging and classification
 * @param supabase SupabaseClient instance
 * @param error Error object or string
 * @param context Additional context data
 * @returns Classification of error 
 */
export const handleError = async (
  supabase: SupabaseClient,
  error: Error | string,
  context: Record<string, any>
): Promise<'recoverable' | 'terminal'> => {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : '';
  const timestamp = new Date().toISOString();
  
  console.error(`[${timestamp}] Error:`, errorMessage);
  console.error('Context:', JSON.stringify(context, null, 2));
  
  if (errorStack) {
    console.error('Stack:', errorStack);
  }
  
  // Log to database if we have a client
  if (supabase) {
    try {
      const { error: logError } = await supabase
        .from('error_logs')
        .insert({
          error_message: errorMessage,
          error_stack: errorStack,
          context: context,
          service: 'content-perfect',
          created_at: timestamp
        });
      
      if (logError) {
        console.error('Failed to log error to database:', logError.message);
      }
    } catch (logError) {
      console.error('Exception when logging error to database:', logError);
    }
  }

  // Classify error as recoverable or terminal
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('temporarily') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests')
  ) {
    return 'recoverable';
  }
  
  return 'terminal';
};

/**
 * Updates the heartbeat for a job
 * @param supabase SupabaseClient instance
 * @param jobId Job ID to update
 */
export const updateHeartbeat = async (
  supabase: SupabaseClient,
  jobId: string
): Promise<void> => {
  try {
    const { error } = await supabase
      .from('content_generation_jobs')
      .update({ 
        heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);
    
    if (error) {
      console.error('Failed to update heartbeat:', error.message);
    }
  } catch (error) {
    console.error('Exception when updating heartbeat:', error);
  }
};

/**
 * Updates the status of a content generation job
 * @param supabase SupabaseClient instance
 * @param jobId Job ID to update
 * @param status New status
 * @param error Optional error message
 */
export const updateJobStatus = async (
  supabase: SupabaseClient,
  jobId: string,
  status: string,
  error?: string
): Promise<void> => {
  try {
    const updateData: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
      heartbeat: new Date().toISOString()
    };
    
    if (error) {
      updateData.error = error;
    }
    
    const { error: updateError } = await supabase
      .from('content_generation_jobs')
      .update(updateData)
      .eq('id', jobId);
    
    if (updateError) {
      console.error('Failed to update job status:', updateError.message);
    }
  } catch (error) {
    console.error('Exception when updating job status:', error);
  }
};

/**
 * Safely parses JSON with error handling
 * @param jsonString String to parse
 * @param defaultValue Default value if parsing fails
 * @returns Parsed object or default value
 */
export const safeJsonParse = <T>(jsonString: string, defaultValue: T): T => {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return defaultValue;
  }
};

/**
 * Creates a checkpoint for recovery
 * @param supabase SupabaseClient instance
 * @param jobId Job ID
 * @param checkpointType Type of checkpoint
 * @param data Checkpoint data
 */
export const createCheckpoint = async (
  supabase: SupabaseClient,
  jobId: string,
  checkpointType: string,
  data: Record<string, any>
): Promise<void> => {
  try {
    const { error } = await supabase
      .from('job_checkpoints')
      .insert({
        job_id: jobId,
        checkpoint_type: checkpointType,
        data: data,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Failed to create checkpoint:', error.message);
    }
  } catch (error) {
    console.error('Exception when creating checkpoint:', error);
  }
};

/**
 * Retrieves the latest checkpoint for a job
 * @param supabase SupabaseClient instance
 * @param jobId Job ID
 * @param checkpointType Type of checkpoint
 * @returns Checkpoint data or null
 */
export const getLatestCheckpoint = async (
  supabase: SupabaseClient,
  jobId: string,
  checkpointType: string
): Promise<Record<string, any> | null> => {
  try {
    const { data, error } = await supabase
      .from('job_checkpoints')
      .select('*')
      .eq('job_id', jobId)
      .eq('checkpoint_type', checkpointType)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Failed to retrieve checkpoint:', error.message);
      return null;
    }
    
    if (data && data.length > 0) {
      return data[0].data;
    }
    
    return null;
  } catch (error) {
    console.error('Exception when retrieving checkpoint:', error);
    return null;
  }
};

/**
 * Checks if a job is stuck and needs recovery
 * @param supabase SupabaseClient instance
 * @param timeoutMinutes Minutes after which a job is considered stuck
 * @returns Array of stuck job IDs
 */
export const findStuckJobs = async (
  supabase: SupabaseClient,
  timeoutMinutes: number = 15
): Promise<string[]> => {
  try {
    const stuckTimestamp = new Date();
    stuckTimestamp.setMinutes(stuckTimestamp.getMinutes() - timeoutMinutes);
    
    const { data, error } = await supabase
      .from('content_generation_jobs')
      .select('id')
      .not('status', 'in', ['completed', 'failed'])
      .lt('heartbeat', stuckTimestamp.toISOString())
      .eq('is_deleted', false);
    
    if (error) {
      console.error('Failed to find stuck jobs:', error.message);
      return [];
    }
    
    return data.map(job => job.id);
  } catch (error) {
    console.error('Exception when finding stuck jobs:', error);
    return [];
  }
};

/**
 * Retrieves a content plan outline by GUID
 * @param supabase SupabaseClient instance
 * @param outlineGuid Outline GUID to retrieve
 * @returns Outline data or null
 */
export const getOutlineByGuid = async (
  supabase: SupabaseClient,
  outlineGuid: string
): Promise<any | null> => {
  try {
    const { data, error } = await supabase
      .from('content_plan_outlines')
      .select('*')
      .eq('guid', outlineGuid)
      .eq('is_deleted', false)
      .single();
    
    if (error) {
      console.error('Failed to get outline:', error.message);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Exception when getting outline:', error);
    return null;
  }
};

/**
 * Parses an outline JSON string into an object
 * @param outlineJson Outline JSON string
 * @returns Parsed outline object
 */
export const parseOutline = (outlineJson: string): any => {
  try {
    const outline = JSON.parse(outlineJson);
    
    // Validate outline structure
    if (!outline.title || !Array.isArray(outline.sections)) {
      throw new Error('Invalid outline structure');
    }
    
    return outline;
  } catch (error) {
    console.error('Failed to parse outline:', error);
    throw error;
  }
};

/**
 * Get the content of a specific section by index
 * @param supabase SupabaseClient instance
 * @param jobId Job ID
 * @param sectionIndex Section index
 * @returns Section data or null
 */
export const getSectionContent = async (
  supabase: SupabaseClient,
  jobId: string,
  sectionIndex: number
): Promise<any | null> => {
  try {
    const { data, error } = await supabase
      .from('content_sections')
      .select('*')
      .eq('job_id', jobId)
      .eq('section_index', sectionIndex)
      .eq('is_deleted', false)
      .single();
    
    if (error) {
      console.error('Failed to get section content:', error.message);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Exception when getting section content:', error);
    return null;
  }
};

/**
 * Get all completed sections for a job
 * @param supabase SupabaseClient instance
 * @param jobId Job ID
 * @returns Array of section data
 */
export const getAllCompletedSections = async (
  supabase: SupabaseClient,
  jobId: string
): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('content_sections')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'completed')
      .eq('is_deleted', false)
      .order('section_index', { ascending: true });
    
    if (error) {
      console.error('Failed to get completed sections:', error.message);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Exception when getting completed sections:', error);
    return [];
  }
};

/**
 * Formats article markdown from sections
 * @param sections Array of section data
 * @param title Article title
 * @returns Formatted markdown content
 */
export const formatMarkdownContent = (
  sections: any[],
  title: string
): string => {
  let markdown = `# ${title}\n\n`;
  
  for (const section of sections) {
    if (section.section_type === 'introduction') {
      markdown += `${section.section_content}\n\n`;
    } else {
      const headingLevel = section.section_type === 'heading' ? '##' : '###';
      markdown += `${headingLevel} ${section.section_title}\n\n${section.section_content}\n\n`;
    }
  }
  
  // Add references section if available
  const referencesData = sections
    .filter(section => section.references_data)
    .flatMap(section => section.references_data);
  
  if (referencesData.length > 0) {
    // Deduplicate references by URL
    const uniqueReferences = referencesData.reduce((acc, ref) => {
      if (!acc.find(r => r.url === ref.url)) {
        acc.push(ref);
      }
      return acc;
    }, []);
    
    markdown += `## References\n\n`;
    
    for (let i = 0; i < uniqueReferences.length; i++) {
      const ref = uniqueReferences[i];
      markdown += `${i + 1}. [${ref.title || ref.url}](${ref.url})\n`;
    }
  }
  
  return markdown;
};

/**
 * Creates a standard response object
 * @param success Whether the operation was successful
 * @param message Response message
 * @param data Additional response data
 * @returns Response object
 */
export const createResponse = (
  success: boolean,
  message: string,
  data?: any
): Record<string, any> => {
  return {
    success,
    message,
    ...(data && { data }),
    timestamp: new Date().toISOString()
  };
};