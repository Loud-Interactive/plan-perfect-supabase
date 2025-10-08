// helpers.ts - shared utility functions for Preferences Perfect API

/**
 * Normalizes domain by removing protocol, www prefix, and trailing slash
 */
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

/**
 * Converts string "true"/"false" to boolean values
 */
export function stringToBool(value: any): any {
  if (value === null || value === undefined) return value;
  
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  
  return value;
}

/**
 * Converts boolean values to lowercase string representation
 */
export function boolToString(value: any): any {
  if (typeof value === 'boolean') {
    return value.toString().toLowerCase();
  }
  return value;
}

/**
 * Standard CORS headers for all edge functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};