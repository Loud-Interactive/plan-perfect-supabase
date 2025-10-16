# Scripts Directory

This directory contains operational scripts for managing the PlanPerfect content pipeline.

## trigger-content-dispatcher.ts

Manually triggers the content queue dispatcher to immediately scale workers based on queue depth.

### Usage

```bash
# Basic usage (uses environment variables)
deno run --allow-net --allow-env scripts/trigger-content-dispatcher.ts

# With explicit env vars
SUPABASE_URL=https://jsypctdhynsdqrfifvdh.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-key-here \
deno run --allow-net --allow-env scripts/trigger-content-dispatcher.ts
```

### Environment Variables

- `SUPABASE_URL` - Supabase project URL (defaults to production)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (required)
- `SUPABASE_ANON_KEY` - Anon key (fallback if service role not set)

### When to Use

- **Force immediate scaling**: When you need to drain a backed-up queue immediately
- **Testing**: To verify dispatcher logic after configuration changes
- **Debugging**: To see dispatcher output and identify issues

### Example Output

```json
{
  "message": "Dispatch cycle completed",
  "dispatches": [
    {
      "stage": "research",
      "queue": "content",
      "workers_triggered": 3
    }
  ],
  "duration_ms": 187
}
```

## Adding New Scripts

When adding scripts to this directory:

1. Use Deno with explicit permissions
2. Add shebang line for direct execution
3. Support environment variable configuration
4. Include error handling and clear output
5. Document in this README
