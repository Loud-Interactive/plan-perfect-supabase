# Shopify Automation Edge Functions

This directory contains Supabase Edge Functions for automating the Shopify blog publishing workflow.

## Functions Overview

### process-shopify-queue

Processes items from the Shopify operations queue, including creating, updating, publishing/unpublishing, and deleting blog articles.

**Invocation:**
- Automatic via scheduled task (recommended every 5 minutes)
- Manual via direct API call
- Triggered by database webhook when new items are added to the queue

**URL:** `/functions/v1/process-shopify-queue`

### shopify-operations

API for manually triggering Shopify operations.

**Invocation:**
- Called by client applications to request Shopify operations

**URL:** `/functions/v1/shopify-operations`

**Parameters:**
- `operation`: String - The operation to perform (sync, update, publish, delete)
- `outlineGuid`: String - GUID of the content outline
- `publishStatus`: Boolean - (Optional) For publish operation, true to publish, false to unpublish

### get-shopify-status

API for retrieving Shopify synchronization status.

**Invocation:**
- Called by client applications to check content status

**URL:** `/functions/v1/get-shopify-status`

**Parameters:**
- `client_id`: String - (Optional) Filter by client ID
- `outline_guid`: String - (Optional) Filter by specific outline GUID
- `limit`: Number - (Optional) Limit number of results, default 100
- `offset`: Number - (Optional) Pagination offset, default 0

### shopify-webhook-handler

Handles webhooks from Shopify to update sync status.

**Invocation:**
- Called by Shopify when article changes occur

**URL:** `/functions/v1/shopify-webhook-handler`

**Headers:**
- `X-Shopify-Topic`: String - Webhook topic (articles/create, articles/update, articles/delete)
- `X-Shopify-Shop-Domain`: String - The Shopify shop domain
- `X-Shopify-Hmac-Sha256`: String - HMAC signature for verification

### shopify-admin-ui

Web-based user interface for managing Shopify integration.

**Invocation:**
- Accessed directly in browser

**URL:** `/functions/v1/shopify-admin-ui`

## Deployment

To deploy these functions, run:

```bash
supabase functions deploy process-shopify-queue
supabase functions deploy shopify-operations
supabase functions deploy get-shopify-status
supabase functions deploy shopify-webhook-handler
supabase functions deploy shopify-admin-ui
```

## Environment Variables

These functions require the following environment variables:

```bash
# Required for Supabase client
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_ANON_KEY="your-anon-key"

# Optional for webhook verification
SHOPIFY_WEBHOOK_SECRET="your-webhook-secret"
```

Set environment variables with:

```bash
supabase secrets set --env production SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set --env production SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set --env production SUPABASE_ANON_KEY=your-anon-key
supabase secrets set --env production SHOPIFY_WEBHOOK_SECRET=your-webhook-secret
```

## Scheduled Execution

To ensure queue items are processed regularly, set up a scheduled task to invoke the `process-shopify-queue` function every 5 minutes.

This can be done through:
1. Supabase scheduled functions (when available)
2. External scheduler (AWS Lambda, Google Cloud Scheduler, etc.)
3. Cron job on a server pinging the function endpoint