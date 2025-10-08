# Outline Generation System

This document explains the outline generation system that uses Jina.ai search and Claude AI for intelligent analysis.

## System Architecture

The outline generation process has been divided into separate functions to improve reliability and prevent timeout issues:

1. **generate-outline**: The entry point function that creates a job and starts the process
2. **search-outline-content**: Handles search term generation and search execution
3. **analyze-outline-content**: Processes search results and generates the final outline

## Job Status Flow

Jobs go through the following statuses:

1. **started**: Initial job created
2. **determining_search_terms**: AI is generating search terms
3. **running_searches**: System is fetching search results
4. **search_completed**: All searches have been completed
5. **analyzing_results**: AI is analyzing search results
6. **generating_outline**: AI is creating the final outline
7. **completed**: Process finished successfully

Error states:
- **error_starting_search**: Initial search function could not be started
- **search_failed**: Error during search phase
- **error_starting_analysis**: Analysis function could not be started
- **analysis_failed**: Error during analysis phase
- **failed**: Generic failure state

## Function Details

### generate-outline

- Creates a new job in the database with initial data
- Calls the search-outline-content function to start the search phase
- Returns immediately with the job ID

### search-outline-content

- Validates the job exists
- Generates search terms using Claude AI with categorization (base, combined, titleAngle, relatedConcept)
- Prioritizes search terms (1-4 priority levels)
- Executes searches via Jina.ai API and saves results
- Updates job status to search_completed
- Triggers analyze-outline-content automatically

### analyze-outline-content

- Validates the job exists and is in the search_completed state
- Retrieves search results from the database
- Performs URL analysis on search results (extracting headings and summaries)
- Generates the final outline using Claude AI
- Saves the outline to the database
- Updates job status to completed

## Database Tables

The system uses these key tables:

1. **outline_generation_jobs**: Tracks jobs and their status
2. **outline_search_terms**: Stores search terms with category and priority
3. **outline_search_results**: Contains results from Jina.ai searches
4. **outline_url_analyses**: Stores URL analyses
5. **content_plan_outlines_ai**: Stores the final generated outlines

## Benefits of the Split Approach

- Prevents timeouts in long-running operations
- Improves error handling and recovery
- Makes debugging easier
- Allows for parallel processing
- Reduces memory usage in each function
- Provides clear status updates during the process

## Usage

To generate an outline, make a POST request to the generate-outline function with:

```json
{
  "content_plan_guid": "optional-guid-for-tracking",
  "post_title": "Your Article Title",
  "content_plan_keyword": "Broader Topic/Category",
  "post_keyword": "Specific Focus Keyword",
  "domain": "yourdomain.com"
}
```

The response will include a job_id that can be used to track progress.