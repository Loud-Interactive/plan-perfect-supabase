// Progressive Profile Building - Ensures we get usable profiles even with failures
// Defines stages of profile completeness and quality scoring

export enum ProfileStage {
  NONE = 'none',          // No data collected
  MINIMAL = 'minimal',    // Just domain and basic info
  BASIC = 'basic',        // Core company info  
  ENHANCED = 'enhanced',  // Most analysis complete
  COMPLETE = 'complete'   // All analysis complete
}

// Required fields for each profile stage
export interface ProfileRequirements {
  [ProfileStage.NONE]: string[];
  [ProfileStage.MINIMAL]: string[];
  [ProfileStage.BASIC]: string[];
  [ProfileStage.ENHANCED]: string[];
  [ProfileStage.COMPLETE]: string[];
}

export const PROFILE_REQUIREMENTS: ProfileRequirements = {
  [ProfileStage.NONE]: [],
  [ProfileStage.MINIMAL]: ['company_name', 'domain'],
  [ProfileStage.BASIC]: [
    'company_name', 
    'domain', 
    'synopsis_elevator_pitch',
    'services_products'
  ],
  [ProfileStage.ENHANCED]: [
    'company_name', 
    'domain', 
    'synopsis_elevator_pitch',
    'services_products', 
    'target_audience', 
    'brand_voice', 
    'company_information'
  ],
  [ProfileStage.COMPLETE]: [] // All 17 analyses
};

// Analysis priorities - higher priority analyses are attempted first
export const ANALYSIS_PRIORITIES: Record<string, number> = {
  'company_details': 10,           // Most critical
  'synopsis_elevator_pitch': 9,
  'services_products': 8,
  'company_information': 7,
  'target_audience': 7,
  'brand_voice': 6,
  'brand_identity': 6,
  'content_strategy': 5,
  'call_to_action': 5,
  'market_focus_business_goals': 4,
  'client_persona': 4,
  'communication_guidelines': 3,
  'language_preferences': 3,
  'brand_voice_details': 3,
  'social_media_contact': 2,
  'competitor_topic_guidelines': 2,
  'trademark_registration_guidelines': 1  // Least critical
};

// Field weights for quality scoring
const FIELD_WEIGHTS: Record<string, number> = {
  'company_name': 10,
  'synopsis_elevator_pitch': 9,
  'services_products': 8,
  'target_audience': 8,
  'brand_voice': 7,
  'company_information': 7,
  'brand_identity': 6,
  'content_strategy': 5,
  'call_to_action': 5,
  'market_focus_business_goals': 4,
  'client_persona': 4,
  'communication_guidelines': 3,
  'brand_voice_details': 3,
  'language_preferences': 2,
  'social_media_contact': 2,
  'competitor_topic_guidelines': 2,
  'trademark_registration_guidelines': 1,
  'brand_document': 5  // Bonus for generated document
};

// Page importance for crawling priority
export interface PageImportance {
  url: string;
  importance: number;
  isRequired: boolean;
  fallbackUrls?: string[];
}

export function categorizePages(pages: Array<{ url: string; title?: string }>): PageImportance[] {
  return pages.map(page => {
    const url = page.url.toLowerCase();
    const title = (page.title || '').toLowerCase();
    
    // Critical pages (required for minimal profile)
    if (url.includes('about') || title.includes('about')) {
      return { url: page.url, importance: 10, isRequired: true };
    }
    if (url === '/' || url.endsWith('/index') || title.includes('home')) {
      return { url: page.url, importance: 10, isRequired: true };
    }
    
    // High importance pages
    if (url.includes('service') || url.includes('product') || 
        title.includes('service') || title.includes('product')) {
      return { url: page.url, importance: 8, isRequired: false };
    }
    if (url.includes('contact') || title.includes('contact')) {
      return { url: page.url, importance: 7, isRequired: false };
    }
    
    // Medium importance
    if (url.includes('team') || url.includes('mission') || 
        url.includes('values') || title.includes('team') ||
        title.includes('mission') || title.includes('values')) {
      return { url: page.url, importance: 6, isRequired: false };
    }
    
    // Lower importance
    if (url.includes('blog') || url.includes('news') ||
        url.includes('case-stud') || url.includes('testimonial')) {
      return { url: page.url, importance: 4, isRequired: false };
    }
    
    // Default
    return { url: page.url, importance: 3, isRequired: false };
  });
}

// Assess which profile stage we've achieved
export function assessProfileStage(completedAnalyses: string[]): ProfileStage {
  // Check from highest to lowest stage
  const stages = [
    ProfileStage.COMPLETE,
    ProfileStage.ENHANCED,
    ProfileStage.BASIC,
    ProfileStage.MINIMAL
  ];

  for (const stage of stages) {
    if (stage === ProfileStage.COMPLETE) {
      // Complete requires all 17 analyses
      if (completedAnalyses.length >= 17) {
        return ProfileStage.COMPLETE;
      }
      continue;
    }

    const required = PROFILE_REQUIREMENTS[stage];
    if (required.every(field => completedAnalyses.includes(field))) {
      return stage;
    }
  }

  return ProfileStage.NONE;
}

// Calculate quality score for a profile
export function calculateQualityScore(pairs: Array<{ key: string; value: string }>): number {
  let totalScore = 0;
  let maxScore = 0;
  const foundFields = new Set<string>();

  // Calculate max possible score
  for (const weight of Object.values(FIELD_WEIGHTS)) {
    maxScore += weight;
  }

  // Score each field
  for (const pair of pairs) {
    const weight = FIELD_WEIGHTS[pair.key];
    if (!weight || foundFields.has(pair.key)) continue;
    
    foundFields.add(pair.key);
    
    // Score based on content quality
    const contentScore = scoreContent(pair.value);
    totalScore += weight * contentScore;
  }

  // Bonus for having brand document
  if (foundFields.has('brand_document')) {
    totalScore += FIELD_WEIGHTS.brand_document;
  }

  return Math.min(1, totalScore / maxScore);
}

// Score individual content quality
function scoreContent(value: string): number {
  if (!value || value.trim().length === 0) return 0;
  
  const length = value.trim().length;
  
  // Too short - likely incomplete
  if (length < 20) return 0.3;
  
  // Good length - likely complete
  if (length >= 50 && length <= 5000) return 1;
  
  // Very long - might be verbose but still valid
  if (length > 5000) return 0.9;
  
  // In between
  return 0.6;
}

// Determine if we have minimum viable profile
export function hasMinimumViableProfile(
  stage: ProfileStage,
  qualityScore: number
): boolean {
  // Need at least basic stage with 40% quality
  return stage >= ProfileStage.BASIC && qualityScore >= 0.4;
}

// Get missing required fields for next stage
export function getMissingFieldsForNextStage(
  currentStage: ProfileStage,
  completedAnalyses: string[]
): string[] {
  const nextStage = getNextStage(currentStage);
  if (!nextStage) return [];
  
  const required = PROFILE_REQUIREMENTS[nextStage];
  return required.filter(field => !completedAnalyses.includes(field));
}

// Get next stage in progression
function getNextStage(currentStage: ProfileStage): ProfileStage | null {
  const progression: Record<ProfileStage, ProfileStage | null> = {
    [ProfileStage.NONE]: ProfileStage.MINIMAL,
    [ProfileStage.MINIMAL]: ProfileStage.BASIC,
    [ProfileStage.BASIC]: ProfileStage.ENHANCED,
    [ProfileStage.ENHANCED]: ProfileStage.COMPLETE,
    [ProfileStage.COMPLETE]: null
  };
  
  return progression[currentStage];
}

// Generate profile completeness report
export interface CompletenessReport {
  stage: ProfileStage;
  qualityScore: number;
  isViable: boolean;
  completedAnalyses: string[];
  missingAnalyses: string[];
  missingForNextStage: string[];
  recommendations: string[];
}

export function generateCompletenessReport(
  pairs: Array<{ key: string; value: string }>
): CompletenessReport {
  const completedAnalyses = [...new Set(pairs.map(p => p.key))];
  const allAnalyses = Object.keys(ANALYSIS_PRIORITIES);
  const missingAnalyses = allAnalyses.filter(a => !completedAnalyses.includes(a));
  
  const stage = assessProfileStage(completedAnalyses);
  const qualityScore = calculateQualityScore(pairs);
  const isViable = hasMinimumViableProfile(stage, qualityScore);
  const missingForNextStage = getMissingFieldsForNextStage(stage, completedAnalyses);
  
  const recommendations: string[] = [];
  
  // Generate recommendations
  if (stage === ProfileStage.NONE) {
    recommendations.push('Critical: No profile data collected. Check scraping and API functionality.');
  } else if (stage === ProfileStage.MINIMAL) {
    recommendations.push('Priority: Complete basic company information to achieve viable profile.');
  } else if (stage < ProfileStage.ENHANCED) {
    recommendations.push(`Good: Profile is ${stage}. Focus on: ${missingForNextStage.join(', ')}`);
  }
  
  if (qualityScore < 0.4) {
    recommendations.push('Quality Warning: Content quality is low. Review data extraction.');
  } else if (qualityScore < 0.7) {
    recommendations.push('Quality Note: Some fields may have incomplete data.');
  }
  
  // Prioritize missing high-value analyses
  const highPriorityMissing = missingAnalyses
    .filter(a => ANALYSIS_PRIORITIES[a] >= 7)
    .sort((a, b) => ANALYSIS_PRIORITIES[b] - ANALYSIS_PRIORITIES[a]);
    
  if (highPriorityMissing.length > 0) {
    recommendations.push(`High Priority Missing: ${highPriorityMissing.slice(0, 3).join(', ')}`);
  }
  
  return {
    stage,
    qualityScore,
    isViable,
    completedAnalyses,
    missingAnalyses,
    missingForNextStage,
    recommendations
  };
}