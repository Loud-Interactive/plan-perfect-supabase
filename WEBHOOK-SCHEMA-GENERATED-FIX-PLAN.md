# Webhook `schema_generated` Event - Fix Plan

## 🎯 Problem Statement

The `schema_generated` webhook event is marked as **invalid** during webhook registration because it's not in the `VALID_EVENTS` list. Clients can only listen to `content_complete` but need `schema_generated` for schema update workflows.

**Current Issue**:
```
❌ schema_generated - Invalid event (not in VALID_EVENTS)
✅ content_complete - Works
✅ content_created - Works (probably)
```

**Client Request**:
> "I was unable to listen to the schema_generated event (it's currently marked as invalid when I try to add it to my events list during webhook registration)"

---

## 🔍 Current State Analysis

### Valid Events (webhook-register/index.ts lines 19-28)

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

**Missing**:
- ❌ `schema_generated` - NOT IN LIST
- ❌ `content_created` - NOT IN LIST (but mentioned by client)

### Webhook Helper Functions (webhook-integration.ts)

**Existing Helpers**:
1. ✅ `notifyTaskStatusChange()` - Maps status to events
2. ✅ `notifyProgressUpdate()` - Progress events
3. ✅ `notifyResearchComplete()` - Research stage
4. ✅ `notifyDraftComplete()` - Draft stage
5. ✅ `notifyQAComplete()` - QA stage

**Missing Helpers**:
- ❌ `notifySchemaGenerated()` - Needs to be created
- ❌ `notifyContentCreated()` - Needs to be created

---

## 📋 Implementation Plan

### Phase 1: Add Events to VALID_EVENTS List

**File**: `supabase/functions/webhook-register/index.ts`

**Change**:
```typescript
const VALID_EVENTS = [
  "content_started",
  "content_progress",
  "content_complete",
  "content_error",
  "content_created",      // ← ADD THIS
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete",
  "schema_generated"      // ← ADD THIS
];
```

---

### Phase 2: Create Webhook Helper Functions

**File**: `supabase/functions/_shared/webhook-integration.ts`

**Add Function 1: notifySchemaGenerated()**

```typescript
/**
 * Notify webhook about schema generation completion
 */
export async function notifySchemaGenerated(
  supabase: any,
  taskId: string,
  schemaData: {
    schema?: string;
    schema_type?: string;
    validation_status?: string;
    schema_url?: string;
  }
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)  // Note: using task_id not id
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url, task.metadata);

  await queueWebhookEvent(
    supabase,
    'schema_generated',
    {
      task_id: taskId,
      schema: schemaData.schema,
      schema_type: schemaData.schema_type,
      validation_status: schemaData.validation_status,
      schema_url: schemaData.schema_url,
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}

/**
 * Notify webhook about content creation (HTML/markdown generated)
 */
export async function notifyContentCreated(
  supabase: any,
  taskId: string,
  contentData: {
    html?: string;
    markdown?: string;
    word_count?: number;
    has_schema?: boolean;
  }
): Promise<void> {
  // Get task details for domain
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url, task.metadata);

  await queueWebhookEvent(
    supabase,
    'content_created',
    {
      task_id: taskId,
      title: task.title,
      url: task.live_post_url,
      word_count: contentData.word_count,
      has_html: !!contentData.html,
      has_markdown: !!contentData.markdown,
      has_schema: contentData.has_schema || false,
      created_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}
```

---

### Phase 3: Trigger Webhooks from Functions

#### Option A: Update generate-side-by-side (Recommended)

**File**: `supabase/functions/generate-side-by-side/index.ts`

**Location**: After saving to database (around line 630-700)

**Add**:
```typescript
import { notifyContentCreated, notifyTaskStatusChange } from '../_shared/webhook-integration.ts';

// ... existing code ...

// Step 12: Update task with generated content
const updateSuccess = await updateTaskById(supabase, taskId!, updateData);

if (updateSuccess) {
  console.log('[Main] ✅ Successfully saved to database');
  
  // NEW: Send webhooks for content creation
  await notifyContentCreated(
    supabase,
    taskId!,
    {
      html: html,
      markdown: markdown,
      word_count: markdown.length,
      has_schema: !!schemaResult.schema
    }
  );
  
  // Send content_complete webhook
  await notifyTaskStatusChange(
    supabase,
    taskId!,
    'completed',
    {
      html_length: html.length,
      markdown_length: markdown.length,
      callout_count: calloutResult.callouts.size,
      has_schema: !!schemaResult.schema
    }
  );
}
```

#### Option B: Separate Schema Generation Function

**File**: `supabase/functions/generate-schema-perfect/index.ts` or new function

**When**: After schema is generated and validated

**Add**:
```typescript
import { notifySchemaGenerated } from '../_shared/webhook-integration.ts';

// After schema generation succeeds
await notifySchemaGenerated(
  supabase,
  taskId,
  {
    schema: cleanedSchema,
    schema_type: classification.primaryType,
    validation_status: 'valid',
    schema_url: postUrl
  }
);
```

**Problem**: `generate-schema-perfect` currently doesn't know about `task_id` - it only gets `url`, `outline_guid`, or `task_id` in request. Need to extract task_id.

---

## 🏗️ Recommended Architecture

### Scenario 1: Standalone Schema Generation (generate-schema-perfect)

**Flow**:
```
1. Client calls generate-schema-perfect with task_id
2. Function generates schema
3. Function saves schema to task.schema_data
4. Function sends schema_generated webhook
5. Client receives webhook
```

**Requirements**:
- Accept `task_id` parameter
- Save schema to database (tasks table)
- Send `schema_generated` webhook
- Return schema to caller

### Scenario 2: Integrated with generate-side-by-side

**Flow**:
```
1. Client calls generate-side-by-side
2. Function generates HTML + markdown
3. Function sends content_created webhook
4. Function optionally generates schema
5. Function sends schema_generated webhook (if schema created)
6. Function sends content_complete webhook
```

**Requirements**:
- Import webhook helpers
- Call webhooks at appropriate stages
- Include schema status in content_created

---

## ✅ Implementation Steps

### Step 1: Add Events to VALID_EVENTS (5 min)

```typescript
// File: supabase/functions/webhook-register/index.ts
const VALID_EVENTS = [
  "content_started",
  "content_progress",
  "content_complete",
  "content_error",
  "content_created",      // NEW
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete",
  "schema_generated"      // NEW
];
```

### Step 2: Create Helper Functions (15 min)

Add `notifySchemaGenerated()` and `notifyContentCreated()` to:
- `supabase/functions/_shared/webhook-integration.ts`

### Step 3: Update generate-side-by-side (10 min)

**Import webhooks**:
```typescript
import { 
  notifyContentCreated, 
  notifyTaskStatusChange 
} from '../_shared/webhook-integration.ts';
```

**Call after save**:
```typescript
if (updateSuccess) {
  // Send content_created webhook
  await notifyContentCreated(supabase, taskId!, {
    html,
    markdown,
    word_count: markdown.length,
    has_schema: false  // Schema skipped in this function
  });
  
  // Send content_complete webhook
  await notifyTaskStatusChange(supabase, taskId!, 'completed', {
    html_length: html.length
  });
}
```

### Step 4: Handle Schema Generation Separately (20 min)

**Option A**: Create `generate-and-save-schema` function
- Accepts `task_id`
- Generates schema using generate-schema-perfect logic
- Saves to task.schema_data column
- Sends `schema_generated` webhook

**Option B**: Update existing schema function
- Modify `generate-schema-perfect` to accept `task_id`
- Add optional `save_to_db` parameter
- Send webhook if task_id provided

---

## 🎯 Recommended Workflow

### Complete Content + Schema Flow

```
Step 1: Generate HTML/Markdown
  POST /generate-side-by-side
  {
    "outline_guid": "xxx",
    "task_id": "yyy"
  }
  → Sends: content_created, content_complete

Step 2: Generate Schema (separate call)
  POST /generate-and-save-schema  [NEW FUNCTION]
  {
    "task_id": "yyy"
  }
  → Sends: schema_generated

OR (if already have live_post_url):

  POST /generate-schema-perfect
  {
    "task_id": "yyy",
    "save_to_db": true
  }
  → Sends: schema_generated
```

---

## 📊 Webhook Event Definitions

### content_created

**When**: HTML and markdown are generated and saved  
**Payload**:
```json
{
  "event": "content_created",
  "data": {
    "task_id": "xxx",
    "title": "Article Title",
    "url": "https://example.com/article",
    "word_count": 2500,
    "has_html": true,
    "has_markdown": true,
    "has_schema": false,
    "created_at": "2025-10-21T..."
  }
}
```

### schema_generated

**When**: JSON-LD schema is generated and saved  
**Payload**:
```json
{
  "event": "schema_generated",
  "data": {
    "task_id": "xxx",
    "schema": "{...full schema...}",
    "schema_type": "Article",
    "validation_status": "valid",
    "schema_url": "https://example.com/article",
    "completed_at": "2025-10-21T..."
  }
}
```

### content_complete

**When**: All content processing is finished  
**Payload**:
```json
{
  "event": "content_complete",
  "data": {
    "task_id": "xxx",
    "status": "completed",
    "html_length": 15000,
    "markdown_length": 12000,
    "callout_count": 5,
    "has_schema": true
  }
}
```

---

## 🧪 Testing Plan

### Test 1: Webhook Registration

```bash
curl -X POST "https://xxx.supabase.co/functions/v1/webhook-register" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-server.com/webhook",
    "email": "test@example.com",
    "secret": "your-secret-key",
    "events": ["content_created", "schema_generated", "content_complete"]
  }'
```

**Expected**: Success (no invalid events error)

### Test 2: Content Creation Webhook

```bash
# Call generate-side-by-side
curl -X POST ".../generate-side-by-side" \
  -H "Content-Type: application/json" \
  -d '{"outline_guid": "xxx", "task_id": "yyy"}'

# Check webhook_events_queue table
SELECT * FROM webhook_events_queue 
WHERE event_type = 'content_created' 
ORDER BY created_at DESC LIMIT 1;
```

**Expected**: content_created event queued

### Test 3: Schema Generation Webhook

```bash
# Call schema generation
curl -X POST ".../generate-schema-perfect" \
  -H "Content-Type: application/json" \
  -d '{"task_id": "yyy", "save_to_db": true}'

# Check webhook_events_queue table
SELECT * FROM webhook_events_queue 
WHERE event_type = 'schema_generated' 
ORDER BY created_at DESC LIMIT 1;
```

**Expected**: schema_generated event queued

---

## 🚧 Implementation Complexity

### Easy Wins (30 min total):
1. ✅ Add events to VALID_EVENTS
2. ✅ Create webhook helper functions
3. ✅ Add webhook calls to generate-side-by-side

### Medium Effort (1-2 hours):
4. ⚠️ Update generate-schema-perfect to accept task_id
5. ⚠️ Add save_to_db functionality
6. ⚠️ Integrate webhook sending

### Alternative (Simpler):
- Just send `content_complete` with a flag: `has_schema: true/false`
- Client checks `has_schema` field instead of listening to separate event

---

## 🎯 Recommended Approach

### Minimal Fix (Fastest)

**Just add the event types and send from generate-side-by-side**:

1. Add `schema_generated` and `content_created` to VALID_EVENTS
2. Create helper functions
3. Call from generate-side-by-side at completion
4. Document that `schema_generated` only fires if schema was generated

**Timeline**: 30-45 minutes  
**Risk**: Low  
**Client Impact**: Can register webhook events immediately

### Complete Fix (Better long-term)

**Make schema generation a first-class webhook event**:

1. Add events to VALID_EVENTS
2. Create helper functions
3. Update generate-side-by-side to send webhooks
4. Create dedicated schema generation + webhook function
5. Update all schema generation code paths

**Timeline**: 2-3 hours  
**Risk**: Medium  
**Client Impact**: Full schema workflow support

---

## 📝 Files to Modify

### Required Changes

1. **webhook-register/index.ts** (lines 19-28)
   - Add `schema_generated` and `content_created` to VALID_EVENTS

2. **_shared/webhook-integration.ts** (end of file)
   - Add `notifySchemaGenerated()` function
   - Add `notifyContentCreated()` function

3. **generate-side-by-side/index.ts** (after database save)
   - Import webhook helpers
   - Call `notifyContentCreated()` after save
   - Call `notifyTaskStatusChange()` for completion

### Optional Enhancements

4. **generate-schema-perfect/index.ts**
   - Accept `task_id` parameter
   - Save schema to database
   - Send `schema_generated` webhook

5. **Database schema**
   - Add `schema_data` column to tasks table (if not exists)
   - Store generated schemas

---

## 🔧 Code Snippets Ready to Use

### 1. Updated VALID_EVENTS

```typescript
const VALID_EVENTS = [
  "content_started",
  "content_progress", 
  "content_complete",
  "content_error",
  "content_created",       // NEW: HTML/markdown generated
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete",
  "schema_generated",      // NEW: JSON-LD schema generated
  "html_updated"           // BONUS: For future HTML updates
];
```

### 2. Helper Function Template

```typescript
export async function notifySchemaGenerated(
  supabase: any,
  taskId: string,
  schemaData: any
): Promise<void> {
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', taskId)
    .single();

  if (!task) {
    console.error(`Task not found: ${taskId}`);
    return;
  }

  const domain = extractDomain(task.live_post_url, task.metadata);

  await queueWebhookEvent(
    supabase,
    'schema_generated',
    {
      task_id: taskId,
      schema: schemaData.schema,
      schema_type: schemaData.schema_type || 'Article',
      validation_status: schemaData.validation_status || 'unknown',
      completed_at: new Date().toISOString()
    },
    domain,
    {
      task_id: taskId,
      ...task.metadata
    }
  );
}
```

---

## ⚠️ Important Considerations

### 1. Database Task Lookup

The webhook helpers use:
```typescript
.select('*')
.eq('task_id', taskId)  // String task_id, not UUID id
.single();
```

**Verify**: Does `tasks` table use `task_id` or `id`? Our functions use both!

### 2. Domain Extraction

Uses `extractDomain()` which looks for domain in:
- task.url
- task.live_post_url  
- task.metadata
- task.custom_fields

**Current**: `generate-side-by-side` uses `live_post_url` from outline

### 3. Webhook Queue vs Direct Send

Two options:
- `queueWebhookEvent()` - Asynchronous, uses webhook_events_queue table
- `sendWebhook()` - Synchronous, immediate HTTP call

**Recommended**: Use `queueWebhookEvent()` (what existing functions use)

---

## 🎬 Action Items

### Immediate (Do This Now):

- [ ] Add `schema_generated` and `content_created` to VALID_EVENTS
- [ ] Redeploy webhook-register function
- [ ] Notify client that events are now valid for registration

### Short-term (This Week):

- [ ] Create webhook helper functions
- [ ] Update generate-side-by-side to send webhooks
- [ ] Test webhook delivery
- [ ] Document webhook payloads

### Long-term (Future):

- [ ] Create dedicated schema generation + save function
- [ ] Add schema_data column to tasks if needed
- [ ] Build schema update workflow
- [ ] Add webhook retry logic

---

## 📚 Related Files

- `supabase/functions/webhook-register/index.ts` - Event validation
- `supabase/functions/_shared/webhook-integration.ts` - Helper functions
- `supabase/functions/_shared/webhook-helpers.ts` - Send logic
- `supabase/functions/webhook-processor/index.ts` - Queue processor
- `supabase/functions/generate-side-by-side/index.ts` - Content generation

---

**Status**: 📋 Plan Complete - Ready for Implementation  
**Estimated Time**: 30-45 minutes for minimal fix  
**Client Impact**: Can register webhook events immediately after fix

