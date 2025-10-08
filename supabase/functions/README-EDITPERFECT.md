# editPerfect Edge Functions

This directory contains Supabase Edge Functions for the editPerfect.ai content editing platform.

## Overview

editPerfect.ai is an AI-powered content editing platform that leverages Claude's advanced reasoning capabilities to transform content according to style guides and brand voice requirements. The platform utilizes Claude's step-by-step thinking process to ensure high-quality, consistent edits that align with brand guidelines.

## Database Setup

Before using these functions, you need to set up the required database tables. Run the following migration script:

```sql
-- Run this script in the Supabase SQL Editor
-- File: migrations/20250403_editperfect_tables.sql
```

## Functions Overview

### generate-edit-job

Creates a new edit job for a content plan outline and triggers the transformation process.

**Invocation:**
- Called by client applications to start the editing process

**URL:** `/functions/v1/generate-edit-job`

**Parameters:**
- `content_plan_outline_guid`: String - GUID of the content plan outline to edit
- `editType`: String - (Optional) Type of edit to perform, default is "style"

### process-style-transformation

Processes a style transformation edit job using Claude.

**Invocation:**
- Automatically triggered by generate-edit-job
- Can be called manually for testing

**URL:** `/functions/v1/process-style-transformation`

**Parameters:**
- `job_id`: Number - ID of the edit job to process

### process-redundancy-removal

Processes a redundancy removal edit job using Claude, typically after style transformation.

**Invocation:**
- Automatically triggered after style transformation
- Can be called manually for testing

**URL:** `/functions/v1/process-redundancy-removal`

**Parameters:**
- `job_id`: Number - ID of the edit job to process

### process-feedback-edits

Processes user feedback to generate suggested changes for content.

**Invocation:**
- Called by client applications when users provide feedback

**URL:** `/functions/v1/process-feedback-edits`

**Parameters:**
- `job_id`: Number - ID of the edit job
- `feedback`: String - User feedback about the content

### generate-html-and-schema

Generates HTML and JSON-LD schema from the edited content.

**Invocation:**
- Called by client applications to generate web-ready content

**URL:** `/functions/v1/generate-html-and-schema`

**Parameters:**
- `job_id`: Number - ID of the edit job
- `template`: String - (Optional) HTML template to use

### get-thinking-logs

Retrieves Claude's thinking logs for an edit job or document version.

**Invocation:**
- Called by client applications to view Claude's reasoning

**URL:** `/functions/v1/get-thinking-logs`

**Query Parameters:**
- `job_id`: Number - (Optional) ID of the edit job
- `version_id`: String - (Optional) ID of the document version
- `prompt_type`: String - (Optional) Type of prompt to filter by
- `limit`: Number - (Optional) Maximum number of results to return
- `offset`: Number - (Optional) Pagination offset

## Deployment

To deploy these functions, run:

```bash
supabase functions deploy generate-edit-job
supabase functions deploy process-style-transformation
supabase functions deploy process-redundancy-removal
supabase functions deploy process-feedback-edits
supabase functions deploy generate-html-and-schema
supabase functions deploy get-thinking-logs
```

## Environment Variables

These functions require the following environment variables:

```bash
# Required for Supabase client
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_ANON_KEY="your-anon-key"

# Required for Claude API
ANTHROPIC_API_KEY="your-anthropic-api-key"
```

Set environment variables with:

```bash
supabase secrets set --env production SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set --env production SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set --env production SUPABASE_ANON_KEY=your-anon-key
supabase secrets set --env production ANTHROPIC_API_KEY=your-anthropic-api-key
```

## Testing

A test interface is provided in `/outline-ui/editperfect-test.html` for testing the edge functions and workflow. You can open this file in a browser and use it to:

1. Start an edit job for a content plan outline
2. Monitor the job status
3. View the original and edited content
4. Submit feedback and view suggested changes
5. Generate HTML and JSON-LD schema
6. View Claude's thinking logs

## Architecture

The editPerfect.ai system follows this workflow:

1. Content is retrieved from a content plan outline
2. A style transformation is applied using Claude
3. Redundancy is removed using Claude
4. User feedback is processed to generate suggested changes
5. HTML and JSON-LD schema are generated for web publishing

Each step captures and stores Claude's detailed reasoning, which can be retrieved for transparency and improvement purposes.