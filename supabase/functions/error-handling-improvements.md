# Error Handling & Timeout Improvements

This document outlines recommended improvements to make the outline generation workflow more robust against errors and timeouts.

## 1. API Timeout Handling

### Add Timeouts to All External API Calls

```typescript
// BEFORE
const searchResponse = await fetch(searchUrl, {
  headers: {
    'Accept': 'application/json',
    'Authorization': 'Bearer key',
    'X-Engine': 'browser'
  }
});

// AFTER
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

try {
  const searchResponse = await fetch(searchUrl, {
    signal: controller.signal,
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer key',
      'X-Engine': 'browser'
    }
  });
  
  clearTimeout(timeout);
  // Process response...
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request timed out');
    // Handle timeout specifically...
  } else {
    // Handle other errors...
  }
}
```

### Add Timeouts for Claude/OpenAI API Calls

```typescript
// Add timeout handling for Claude API calls
try {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Claude API timeout')), 120000));
    
  const apiResponse = await Promise.race([
    anthropic.beta.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 32000,
      temperature: 1,
      messages: [{ role: "user", content: prompt }]
    }),
    timeoutPromise
  ]);
  
  // Process response...
} catch (error) {
  if (error.message === 'Claude API timeout') {
    // Specific timeout handling
    await recordTimeoutError(job_id, 'claude_api_timeout');
  } else {
    // Other error handling
  }
}
```

## 2. Database Operation Improvements

### Transaction Support for Critical Operations

```typescript
// Use transactions for related database operations
const { error } = await supabase.rpc('process_outline_with_transaction', {
  job_id: id,
  new_status: 'processing'
});
```

Create a corresponding stored procedure:

```sql
CREATE OR REPLACE FUNCTION process_outline_with_transaction(
  job_id UUID,
  new_status TEXT
) RETURNS void AS $$
BEGIN
  -- Start transaction
  BEGIN
    -- Update job status
    UPDATE outline_generation_jobs
    SET status = new_status, updated_at = now()
    WHERE id = job_id;
    
    -- Insert status update
    INSERT INTO content_plan_outline_statuses (outline_guid, status)
    VALUES (job_id, 'Status changed to: ' || new_status);
    
    -- Commit transaction
    COMMIT;
  EXCEPTION WHEN OTHERS THEN
    -- Rollback on error
    ROLLBACK;
    RAISE;
  END;
END;
$$ LANGUAGE plpgsql;
```

## 3. Implement Heartbeat System

### Add Heartbeat Field to Jobs Table

```sql
ALTER TABLE outline_generation_jobs 
ADD COLUMN heartbeat_at TIMESTAMPTZ;
```

### Update Heartbeat Regularly

```typescript
// Add to process functions
const heartbeatInterval = setInterval(async () => {
  try {
    await supabase
      .from('outline_generation_jobs')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', job_id);
  } catch (err) {
    console.error('Heartbeat update failed:', err);
  }
}, 30000); // 30 seconds

// Clear interval when done
clearInterval(heartbeatInterval);
```

### Detect Stuck Jobs Based on Heartbeat

```typescript
// Add to rescue-stuck-outlines function
const heartbeatCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

const { data: stuckByHeartbeat } = await supabase
  .from('outline_generation_jobs')
  .select('*')
  .in('status', ['analyzing_results', 'generating_outline', 'search_queued'])
  .lt('heartbeat_at', heartbeatCutoff.toISOString())
  .is('is_deleted', false);

// Process these stuck jobs...
```

## 4. Retry Mechanism with Exponential Backoff

### Create a Reusable Retry Function

```typescript
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
  let retryCount = 0;
  let lastError;
  
  while (retryCount < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      retryCount++;
      
      // Log retry attempt
      console.log(`Retry attempt ${retryCount}/${maxRetries} after error: ${error.message}`);
      
      // Skip retry if it's a non-recoverable error
      if (isNonRecoverableError(error)) {
        console.log('Non-recoverable error, aborting retries');
        throw error;
      }
      
      // Exponential backoff delay with jitter
      const delay = Math.pow(2, retryCount) * initialDelay * (0.9 + Math.random() * 0.2);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If all retries failed, throw the last error
  throw lastError;
}

function isNonRecoverableError(error) {
  // Define conditions for non-recoverable errors
  return error.message.includes('invalid parameters') || 
         error.message.includes('access denied') ||
         error.message.includes('not found');
}
```

### Apply to External API Calls

```typescript
// Before: direct API call
const response = await fetch('https://api.example.com/data');

// After: with retry
const response = await retryWithBackoff(
  () => fetch('https://api.example.com/data'),
  3,  // max retries
  2000 // initial delay in ms
);
```

## 5. Error Recording and Monitoring

### Create a Centralized Error Logger

```typescript
async function logError(functionName, jobId, error, context = {}) {
  const errorDetail = {
    function: functionName,
    job_id: jobId,
    error_message: error.message,
    error_stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  };
  
  console.error(JSON.stringify(errorDetail));
  
  try {
    await supabase
      .from('error_logs')
      .insert({
        function_name: functionName,
        job_id: jobId,
        error_message: error.message,
        error_stack: error.stack,
        context_data: context,
        created_at: new Date().toISOString()
      });
  } catch (logError) {
    // If logging to DB fails, at least we logged to console
    console.error('Failed to record error in database:', logError);
  }
}
```

### Create Error Logs Table

```sql
CREATE TABLE error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  function_name TEXT NOT NULL,
  job_id UUID,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  context_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX error_logs_job_id_idx ON error_logs(job_id);
CREATE INDEX error_logs_function_name_idx ON error_logs(function_name);
CREATE INDEX error_logs_created_at_idx ON error_logs(created_at);
```

## 6. Checkpoint System for Recovery

### Create Checkpoint Table

```sql
CREATE TABLE job_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL,
  checkpoint_name TEXT NOT NULL,
  checkpoint_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_job_checkpoint UNIQUE (job_id, checkpoint_name)
);

CREATE INDEX job_checkpoints_job_id_idx ON job_checkpoints(job_id);
```

### Implement Checkpoint Functions

```typescript
async function saveCheckpoint(jobId, checkpointName, data = {}) {
  try {
    // Upsert to handle duplicate checkpoint names
    const { error } = await supabase
      .from('job_checkpoints')
      .upsert({
        job_id: jobId,
        checkpoint_name: checkpointName,
        checkpoint_data: data
      }, {
        onConflict: 'job_id,checkpoint_name',
        update: ['checkpoint_data', 'created_at']
      });
      
    if (error) throw error;
    console.log(`Saved checkpoint '${checkpointName}' for job ${jobId}`);
  } catch (err) {
    console.error(`Failed to save checkpoint:`, err);
  }
}

async function loadCheckpoint(jobId, checkpointName) {
  try {
    const { data, error } = await supabase
      .from('job_checkpoints')
      .select('checkpoint_data')
      .eq('job_id', jobId)
      .eq('checkpoint_name', checkpointName)
      .single();
      
    if (error) return null;
    return data?.checkpoint_data;
  } catch (err) {
    console.error(`Failed to load checkpoint:`, err);
    return null;
  }
}
```

### Use Checkpoints in Processing Flow

```typescript
// Example usage in analyze-outline-content
async function analyzeSearchResults(jobId) {
  // Try to load checkpoint first
  const checkpoint = await loadCheckpoint(jobId, 'search_analysis');
  
  if (checkpoint) {
    console.log(`Resuming from search_analysis checkpoint for job ${jobId}`);
    return checkpoint;
  }
  
  // If no checkpoint, do the normal processing
  const results = await performSearchAnalysis(jobId);
  
  // Save checkpoint after processing
  await saveCheckpoint(jobId, 'search_analysis', results);
  
  return results;
}
```

## Implementation Priority

1. API Timeout Handling - Highest priority
2. Error Recording and Monitoring
3. Heartbeat System
4. Retry Mechanism
5. Database Transaction Support
6. Checkpoint System

These improvements should dramatically reduce the number of stuck jobs and make recovery much more seamless when issues do occur.