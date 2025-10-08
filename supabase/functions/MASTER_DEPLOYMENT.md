# PlanPerfect Supabase Functions - Master Deployment Guide

This guide covers the deployment of all Supabase Edge Functions and database triggers required for the PlanPerfect application.

## 1. Required Environment Variables

Set the following environment variables in the Supabase dashboard:

```
GROQ_API_KEY=[Your Groq API key]
SUPABASE_URL=https://jsypctdhynsdqrfifvdh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MDY5MjAzMiwiZXhwIjoyMDU2MjY4MDMyfQ.19Eds9LcZbb-rwLCpPJsk7kMIa7eTU7wIw_-Yn_iyG8
SENDGRID_API_KEY=[Your SendGrid API key]
APP_URL=https://app.planperfect.com
```

## 2. Database Tables

The following additional tables need to be created:

### Factchecks Table

```sql
CREATE TABLE public.factchecks (
  factcheck_guid UUID PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(task_id),
  factcheck_data TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

### Indices Table

```sql
CREATE TABLE public.indices (
  index_guid UUID PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(task_id),
  index_data TEXT,
  index_html TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

## 3. Deploy Edge Functions

Deploy each function using the Supabase CLI:

```bash
# Schema Generation Function
supabase functions deploy generate-schema

# Schema Generation Stream Function
supabase functions deploy generate-schema-stream

# Fact Check Function
supabase functions deploy generate-factcheck

# Index Generation Function
supabase functions deploy generate-index

# Meta Description Function
supabase functions deploy generate-meta-description

# Email Notification Function
supabase functions deploy send-notification

# API Function (handles all API endpoints)
supabase functions deploy api

# Content Plan Update Function
supabase functions deploy update-content-plan
```

## 4. Deploy Database Setup and Triggers

1. First, execute the SQL in `database-setup.sql` in the Supabase SQL Editor to create the required stored procedures and RLS policies.

2. Then, execute the SQL in `database-triggers.sql` in the Supabase SQL Editor to create the event triggers.

## 5. Testing Each Function

### Schema Generation

```sql
-- First, ensure a task exists with content
UPDATE public.tasks
SET live_post_url = 'https://example.com/blog-post'
WHERE task_id = '[task_id]';
```

### Fact Check

```sql
-- Request a fact check
UPDATE public.tasks
SET factcheck_status = 'Requested'
WHERE task_id = '[task_id]';
```

### Index Generation

```sql
-- Request index generation
UPDATE public.tasks
SET index_status = 'Requested'
WHERE task_id = '[task_id]';
```

### Meta Description Generation

```sql
-- Trigger meta description generation by updating content
-- (if meta_description is NULL)
UPDATE public.tasks
SET content = '[html_content]'
WHERE task_id = '[task_id]';
```

### Email Notification

```sql
-- Trigger email notification by changing status
UPDATE public.tasks
SET status = 'Complete'
WHERE task_id = '[task_id]';
```

## 6. Monitoring

You can monitor function invocations and logs from the Supabase Dashboard:

1. Go to the Project Dashboard
2. Navigate to "Edge Functions"
3. Select the function to view its logs and invocation history

## 7. Troubleshooting

Common issues:

1. **Missing environment variables**: Ensure all environment variables are set correctly in the Supabase dashboard.
2. **Function timeouts**: Edge functions have a 60-second timeout. For large content, consider chunking processing.
3. **Database permission issues**: Ensure the service role key has necessary permissions to read and write to all required tables.
4. **Rate limiting**: Be aware of Groq API rate limits for high-volume processing.

If a function fails, check the logs in the Supabase dashboard for detailed error messages.

## 8. Function Endpoints

All functions are accessible at the following endpoints:

### Content Processing Functions
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-stream
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-factcheck
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-index
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-meta-description
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/send-notification
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/update-content-plan
```

### API Endpoints

#### Basic API Endpoints
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/ping [GET]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/add [POST]
```

#### Content Status Endpoints
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/{content_plan_outline_guid}/status [GET]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/status/{content_plan_outline_guid} [GET] (Alternate format)
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/status/batch [POST]
```

#### Task Update Endpoints
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/update/{content_plan_outline_guid} [PUT]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/update/{content_plan_outline_guid}/field [PATCH]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/posts/{guid}/field [PATCH]
```

#### Content URL Endpoints
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/posts/{guid}/live-post-url [PUT]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/posts/{guid}/html [PUT]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/posts/{guid}/google-doc [PUT]
```

#### Task Listing and Deletion Endpoints
```
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/domain/{client_domain} [GET]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/email/{email} [GET]
https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/api/content/delete/{content_plan_outline_guid} [DELETE]
```

Each content processing endpoint accepts a POST request with the appropriate parameters as documented in the function code.

The API endpoints support multiple HTTP methods as indicated in brackets:
- GET for ping, status, and task listing endpoints
- POST for content/add and batch status endpoints
- PUT for updating task data and URLs
- PATCH for updating individual fields
- DELETE for removing tasks