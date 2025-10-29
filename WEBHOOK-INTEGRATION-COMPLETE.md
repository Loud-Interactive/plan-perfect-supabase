# Webhook Integration - Complete ✅

## 🎉 Implementation Complete

All webhook events are now registered and integrated into schema generation functions!

**Deployed**: October 21, 2025  
**Status**: ✅ Production Ready

---

## ✅ What Was Fixed

### 1. Added Missing Events to VALID_EVENTS

**File**: `webhook-register/index.ts`

**Before**:
```typescript
const VALID_EVENTS = [
  "content_started",
  "content_progress",
  "content_complete",
  "content_error",
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete"
];
```

**After**:
```typescript
const VALID_EVENTS = [
  "content_started",
  "content_progress",
  "content_complete",
  "content_error",
  "content_created",      // ← ADDED
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete",
  "schema_generated"      // ← ADDED
];
```

---

### 2. Created Webhook Helper Functions

**File**: `_shared/webhook-integration.ts`

**Added Functions**:
1. ✅ `notifyContentCreated()` - For HTML/markdown generation
2. ✅ `notifySchemaGenerated()` - For JSON-LD schema generation

**Features**:
- Automatically fetches task details from database
- Extracts domain from task
- Queues webhook event to `webhook_events_queue` table
- Includes full metadata and payload

---

### 3. Integrated Webhooks into Functions

#### ✅ generate-schema (Non-streaming)

**Triggers**: `schema_generated` webhook  
**When**: After schema is successfully generated and saved  
**Payload Includes**:
- schema (full JSON-LD)
- schema_type (`Article`)
- validation_status (`valid`)
- url
- reasoning

#### ✅ generate-schema-stream (Streaming)

**Triggers**: `schema_generated` webhook  
**When**: After schema streaming completes  
**Payload Includes**:
- schema (full JSON-LD)
- schema_type (`Article`)
- validation_status (`valid`)
- url

#### ✅ generate-schema-perfect (Streaming with classification)

**Triggers**: `schema_generated` webhook  
**When**: After schema is generated, cleaned, and validated  
**Payload Includes**:
- schema (full cleaned JSON-LD)
- schema_type (detected type: Article, Product, Recipe, etc.)
- validation_status (`valid`)
- url
- reasoning (classification reasoning)

#### ✅ generate-side-by-side (HTML generation)

**Triggers**: TWO webhooks  
1. `content_created` - After HTML/markdown saved
2. `content_complete` - After full completion

**content_created Payload**:
- task_id
- title
- url
- word_count
- has_html
- has_markdown
- has_schema
- created_at

**content_complete Payload**:
- task_id
- status
- html_length
- markdown_length
- callout_count
- has_schema
- schema_skipped

---

## 📋 Webhook Event Reference

### Schema Events

| Event | When Fired | Functions | Payload |
|-------|------------|-----------|---------|
| `schema_generated` | Schema successfully generated | generate-schema, generate-schema-stream, generate-schema-perfect | task_id, schema, schema_type, validation_status, url, reasoning |
| `content_created` | HTML/markdown saved to DB | generate-side-by-side | task_id, title, url, word_count, has_html, has_markdown, has_schema |
| `content_complete` | All content processing done | generate-side-by-side | task_id, status, html_length, markdown_length, callout_count, has_schema |

### Existing Events (Already Working)

| Event | When Fired |
|-------|------------|
| `content_started` | Content generation starts |
| `content_progress` | Progress updates |
| `content_error` | Error occurs |
| `outline_generated` | Outline created |
| `research_complete` | Research stage done |
| `draft_complete` | Draft stage done |
| `qa_complete` | QA stage done |

---

## 🚀 How to Register for Events

**Endpoint**: `POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/webhook-register`

**Request**:
```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/webhook-register" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-server.com/webhook",
    "email": "your@email.com",
    "secret": "your-webhook-secret",
    "events": ["content_created", "schema_generated", "content_complete"]
  }'
```

**Response**:
```json
{
  "success": true,
  "message": "Webhook registered successfully",
  "webhook_id": "uuid",
  "events": ["content_created", "schema_generated", "content_complete"]
}
```

---

## 📊 Example Webhook Payloads

### content_created Event

```json
{
  "event": "content_created",
  "data": {
    "task_id": "abc-123",
    "title": "Guide to Medical Transport",
    "url": "https://medidrive.com/blog/medical-transport",
    "word_count": 2500,
    "has_html": true,
    "has_markdown": true,
    "has_schema": false,
    "created_at": "2025-10-21T15:30:00Z"
  },
  "domain": "medidrive.com",
  "timestamp": "2025-10-21T15:30:00Z"
}
```

### schema_generated Event

```json
{
  "event": "schema_generated",
  "data": {
    "task_id": "abc-123",
    "url": "https://medidrive.com/blog/medical-transport",
    "schema": "{\"@context\":\"https://schema.org\",\"@type\":\"Article\",...}",
    "schema_type": "Article",
    "validation_status": "valid",
    "reasoning": "Content contains article structure with author, date...",
    "schema_length": 1523,
    "completed_at": "2025-10-21T15:30:15Z"
  },
  "domain": "medidrive.com",
  "timestamp": "2025-10-21T15:30:15Z"
}
```

### content_complete Event

```json
{
  "event": "content_complete",
  "data": {
    "task_id": "abc-123",
    "status": "completed",
    "html_length": 15234,
    "markdown_length": 12500,
    "callout_count": 5,
    "has_schema": false,
    "schema_skipped": true
  },
  "domain": "medidrive.com",
  "timestamp": "2025-10-21T15:30:20Z"
}
```

---

## 🧪 Testing Webhooks

### Test 1: Register for Events

```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/webhook-register" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://webhook.site/your-unique-id",
    "email": "test@example.com",
    "secret": "test-secret-123",
    "events": ["schema_generated", "content_created", "content_complete"]
  }'
```

### Test 2: Generate Content (Triggers content_created + content_complete)

```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side" \
  -H "Content-Type: application/json" \
  -d '{
    "outline_guid": "your-outline-guid",
    "task_id": "your-task-id"
  }'
```

### Test 3: Generate Schema (Triggers schema_generated)

```bash
curl -X POST "https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema-perfect" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "your-task-id",
    "url": "https://example.com/article"
  }'
```

### Test 4: Check Webhook Queue

```sql
SELECT * FROM webhook_events_queue 
WHERE event_type IN ('schema_generated', 'content_created', 'content_complete')
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 📊 Deployed Functions

| Function | Version | Webhooks | Status |
|----------|---------|----------|--------|
| `webhook-register` | Updated | Validates events | ✅ Live |
| `generate-schema` | Updated | schema_generated | ✅ Live |
| `generate-schema-stream` | Updated | schema_generated | ✅ Live |
| `generate-schema-perfect` | Updated | schema_generated | ✅ Live |
| `generate-side-by-side` | Updated | content_created, content_complete | ✅ Live |

---

## 🎯 What This Enables

### For Clients

1. **Register for `schema_generated`** - No longer marked as invalid ✅
2. **Register for `content_created`** - Track when HTML/markdown is ready ✅
3. **Separate workflows** - Different actions for content vs schema
4. **Full visibility** - Know exactly when each asset is ready

### Workflow Examples

**Example 1: Content First, Schema Later**
```
1. content_created → Publish HTML to CMS
2. schema_generated → Update page with schema
3. content_complete → Mark job as done
```

**Example 2: Wait for Everything**
```
1. content_created → Log event
2. schema_generated → Log event
3. content_complete → Publish everything together
```

---

## 🔍 Webhook Verification

### HMAC Signature

All webhooks include an HMAC signature header for verification:
```
X-Webhook-Signature: sha256=...
```

**Verify in your code**:
```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(
        f"sha256={expected}",
        signature
    )
```

---

## 📝 Notes for Clients

### ✅ You Can Now:

1. **Register for `schema_generated` event** - No longer invalid!
2. **Register for `content_created` event** - Track content creation
3. **Receive separate notifications** for content vs schema
4. **Build conditional workflows** based on event type

### Event Timing

**Typical Flow**:
```
generate-side-by-side called
    ↓ (10-20s)
content_created webhook → HTML/markdown ready
    ↓ (immediately)
content_complete webhook → All done
    ↓ (separate call)
generate-schema-perfect called  
    ↓ (5-15s)
schema_generated webhook → Schema ready
```

### Important Notes

- Webhooks are **asynchronous** - queued then processed
- `schema_generated` only fires if `task_id` is provided
- `content_created` fires from generate-side-by-side
- All webhooks include full task context

---

## 🎬 Next Steps for Clients

1. ✅ **Update webhook registration** to include new events
2. ✅ **Update webhook handler** to process `schema_generated` and `content_created`
3. ✅ **Test with webhook.site** or similar testing tool
4. ✅ **Implement verification** using HMAC signatures

---

**Status**: ✅ Complete and Deployed  
**Client Message**: "You can now add the schema_generated event to your webhooks registration! It's fully supported." 🎉

