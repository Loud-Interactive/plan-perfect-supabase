# Content Perfect

Content Perfect is a system for generating high-quality content from outlines. It uses a distributed, queue-based architecture with Supabase Edge Functions to ensure reliability and fault tolerance.

## Architecture

Content Perfect follows a multi-stage process:

1. **Job Creation**: Creates a new content generation job from an outline
2. **Research**: Generates search queries and gathers reference material for each section
3. **Content Generation**: Processes each section individually with Claude AI
4. **Assembly**: Combines all sections into a complete article
5. **Conversion**: Transforms markdown to HTML and generates schema.org data

Each stage is handled by separate edge functions to prevent timeouts and ensure resilience.

## Database Schema

The system uses several tables:

- `content_generation_jobs`: Tracks overall job status and progress
- `content_sections`: Stores section content and metadata
- `section_search_queries`: Manages search queries for each section
- `section_search_results`: Stores search results and relevance data
- `content_section_queue`: Handles the processing queue for sections
- `generated_content`: Stores completed content in markdown and HTML formats

## Edge Functions

### Core Functions

- `create-content-job`: Creates a new content generation job
- `process-content-job`: Orchestrates the overall content generation process
- `generate-section-queries`: Generates search queries for a section
- `execute-section-queries`: Runs web searches for section queries
- `analyze-section-references`: Analyzes search results and prepares references
- `generate-content-section`: Generates content for a specific section
- `assemble-content`: Combines sections into a complete article
- `convert-to-html`: Transforms markdown to HTML and generates schema

### Utility Functions

- `get-content-job-status`: Returns detailed job status
- `reset-stuck-content-job`: Resets a stuck job for reprocessing

## Job Status Flow

```
┌─────────┐      ┌───────────┐      ┌───────────────┐      ┌──────────────┐      ┌────────────┐      ┌───────────┐
│ pending │─────►│ research  │─────►│ processing    │─────►│ assembling   │─────►│ converting │─────►│ completed │
└─────────┘      └───────────┘      │ (sections)    │      │              │      │            │      └───────────┘
                                    └───────────────┘      └──────────────┘      └────────────┘      
                                           │                      │                    │                ┌─────────┐
                                           └──────────────────────┴────────────────────┴──────────────►│ failed   │
                                                                                                       └─────────┘
```

## Error Handling

The system includes robust error handling with:

- Detailed error logging to the database
- Classification of errors as recoverable or terminal
- Automatic retry for recoverable errors
- Heartbeat tracking to detect stuck jobs

## Recovery Mechanisms

- Each job checkpoint is stored in the database
- Jobs can be automatically reset if they stall
- Processing can resume from the most recent successful state
- Sections are processed independently to limit the impact of failures

## Usage

To start content generation for an outline:

```
POST /functions/v1/create-content-job
{
  "outline_guid": "558273de-297c-43df-9fd3-3749171a1667"
}
```

To check job status:

```
POST /functions/v1/get-content-job-status
{
  "job_id": "job-guid-here"
}
```

To reset a stuck job:

```
POST /functions/v1/reset-stuck-content-job
{
  "job_id": "job-guid-here"
}
```

## Cron Job Setup

A cron job should be set up to handle background processing:

```sql
-- Run every 5 minutes
select cron.schedule(
  'rescue-stuck-content-jobs',
  '*/5 * * * *',
  $$
  with stale_jobs as (
    select id
    from content_generation_jobs
    where heartbeat < now() - interval '15 minutes'
    and status not in ('completed', 'failed')
    and is_deleted = false
    limit 10
  )
  select
    pg_net.http_post(
      '{{supabase_url}}/functions/v1/reset-stuck-content-job',
      jsonb_build_object('job_id', id),
      '{"Content-Type": "application/json", "Authorization": "Bearer {{anon_key}}"}'
    )
  from stale_jobs;
  $$
);
```

## Dependencies

- Supabase JS Client
- Claude API
- Marked (for markdown conversion)
- Google Search API (for reference gathering)