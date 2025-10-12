# Generate Side-by-Side Edge Function

**Complete HTML blog post generation with AI-enhanced callouts**

This edge function generates complete HTML blog posts from outlines, including:
- Markdown generation from outline structure
- JSON conversion with structured data
- HTML construction with custom styling
- AI-generated callouts using Groq Kimi-k2
- AI-enhanced summaries
- Preference loading from pairs table
- Full task tracking and status updates

---

## 🚀 Features

### Core Functionality
- ✅ **Markdown Generation**: Claude API converts outline to full markdown content
- ✅ **JSON Conversion**: Structured JSON with sections, subsections, references
- ✅ **HTML Construction**: Complete HTML document with proper formatting
- ✅ **AI Callouts**: Groq Kimi-k2 generates contextual one-sentence callouts
- ✅ **AI Summary**: Groq Kimi-k2 generates enhanced paragraph summary (4-6 sentences)
- ✅ **JSON-LD Schema**: Groq gpt-oss-120b generates comprehensive SEO schema with reasoning
- ✅ **Callout Templates**: Uses domain-specific templates from pairs table
- ✅ **Alternating Callouts**: Left/right positioning with proper CTA configuration
- ✅ **Preferences Loading**: Fetches all settings from pairs table by domain
- ✅ **Task Tracking**: Granular status updates throughout the process
- ✅ **Error Handling**: Comprehensive error handling and logging

### Content Features
- ✅ **Reference Links**: Superscript citation links `[1]`, `[2]`, etc.
- ✅ **List Parsing**: Automatic detection and formatting of lists
- ✅ **Social Icons**: Company social media icons with theme support
- ✅ **Table of Contents**: Auto-generated TOC with section links
- ✅ **Custom Styles**: Domain-specific CSS from Supabase storage
- ✅ **Hero Images**: Support for hero images from task or defaults
- ✅ **Key Takeaways**: Structured key takeaways with CTAs
- ✅ **Quotes**: Optional quote sections with attribution

---

## 📋 Architecture

### Data Flow

```
INPUT: { outline_guid, task_id? }
    ↓
1. Fetch outline from content_plan_outlines
2. Fetch client info (content_plans, synopsis, pairs)
3. Create/update task record
    ↓
4. Generate markdown from outline (Claude API)
5. Convert markdown to structured JSON (Claude API)
    ↓
6. Load preferences from pairs table
7. Generate callout texts (Groq Kimi-k2)
8. Generate enhanced summary (Groq Kimi-k2)
    ↓
9. Construct HTML with callouts
10. Update task with all generated data
    ↓
OUTPUT: { success, task_id, html_length, json_sections, callouts_generated }
```

### File Structure

```
supabase/functions/
├── generate-side-by-side/
│   ├── index.ts              # Main handler
│   ├── config.toml           # JWT configuration
│   ├── test.sh               # Test script
│   └── README.md             # This file
├── utils/html-generation/
│   ├── types.ts              # TypeScript interfaces
│   ├── list-parser.ts        # List parsing utilities
│   ├── preferences-loader.ts # Preferences from pairs table
│   ├── callout-generator.ts  # Groq-based callout generation
│   └── html-constructor.ts   # HTML construction with callouts
└── helpers/
    └── index.ts              # CORS headers, etc.
```

---

## 🔧 Environment Variables

Required environment variables (automatically set by Supabase):

| Variable | Purpose | Auto-Set |
|----------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access key | ✅ |
| `ANTHROPIC_API_KEY` | Claude API for markdown/JSON | ✅ |
| `GROQ_API_KEY` | Groq Kimi-k2 for callouts/summary | ✅ |

---

## 📝 API Usage

### Request Format

```bash
POST /functions/v1/generate-side-by-side
Content-Type: application/json

{
  "outline_guid": "uuid-of-outline",  # Required
  "task_id": "uuid-of-task"           # Optional (will create if not provided)
}
```

### Response Format

**Success:**
```json
{
  "success": true,
  "task_id": "uuid-of-task",
  "outline_guid": "uuid-of-outline",
  "html_length": 45678,
  "json_sections": 5,
  "callouts_generated": 5
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "task_id": "uuid-of-task"
}
```

---

## 🧪 Testing

### Local Testing

```bash
# Start Supabase locally
supabase start

# In another terminal, serve the function
supabase functions serve generate-side-by-side --no-verify-jwt

# Run test script
cd supabase/functions/generate-side-by-side
./test.sh YOUR_OUTLINE_GUID
```

### Test with cURL

```bash
# Test locally
curl -X POST http://127.0.0.1:54321/functions/v1/generate-side-by-side \
  -H "Content-Type: application/json" \
  -d '{"outline_guid": "YOUR_GUID"}' \
  | jq '.'

# Test deployed function
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side \
  -H "Content-Type: application/json" \
  -d '{"outline_guid": "YOUR_GUID"}' \
  | jq '.'
```

---

## 🚀 Deployment

```bash
# Deploy function
supabase functions deploy generate-side-by-side --project-ref jsypctdhynsdqrfifvdh

# Verify deployment
curl -X POST https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-side-by-side \
  -H "Content-Type: application/json" \
  -d '{"outline_guid": "test-guid"}'
```

---

## 📊 Database Tables Used

### Read Operations
- `content_plan_outlines` - Fetch outline data
- `content_plans` - Fetch brand voice, keywords
- `synopsis` - Fetch voice/tone settings
- `pairs` - Fetch preferences, callout templates

### Write Operations
- `tasks` - Create/update task records with status tracking

---

## 🎯 Callout System

### How Callouts Work

1. **Template Loading**: Fetches `post_callout_left` and `post_callout_right` HTML templates from pairs table
2. **H2 Extraction**: Extracts all H2 sections (excluding special sections like summary, TOC, references)
3. **AI Generation**: Uses Groq Kimi-k2 to generate ONE compelling sentence per section
4. **Positioning**: Alternates left/right (first section = left, second = right, etc.)
5. **Injection**: Inserts callout HTML after each H2 heading
6. **CTA Replacement**: Replaces `{cta_url}` and `{cta_text}` placeholders with actual values

### Callout Requirements

- ✅ Single sentence per section
- ✅ Statement or question based on content
- ❌ NO hypothetical questions
- ❌ NO "This section is about/explains/discusses/outlines" starts
- ✅ Directly derived from section content
- ✅ Engaging and valuable

### Excluded Sections

Callouts are NOT added to:
- Summary
- Table of Contents
- Key Takeaways
- References
- Conclusion

---

## ⚙️ Preferences from Pairs Table

### Required Keys

| Key | Type | Purpose | Default |
|-----|------|---------|---------|
| `post_callout_left` | HTML | Left callout template | Default template |
| `post_callout_right` | HTML | Right callout template | Default template |
| `callout_left_cta_dest_url` | URL | Left CTA URL | `#` |
| `callout_left_cta_anchor_text` | Text | Left CTA text | `Learn More` |
| `callout_right_cta_dest_url` | URL | Right CTA URL | `#` |
| `callout_right_cta_anchor_text` | Text | Right CTA text | `Learn More` |
| `key_takeaways_cta_dest_url` | URL | Takeaways CTA URL | `#` |
| `key_takeaways_cta_anchor_text` | Text | Takeaways CTA text | `Get Started` |
| `company_name` | Text | Company name | `Company` |
| `about_company` | Text | Company description | Default text |
| `author_name` | Text | Author name | `Author` |
| `domain` | Text | Domain for CSS | Used for stylesheet URL |

---

## 🔄 Task Status Progression

The function updates task status throughout execution:

1. `loading_preferences` - Initial state (after task creation), loading preferences from pairs table
2. `generating_markdown` - Claude API generating full markdown content from outline
3. `converting_markdown_to_json` - Claude API converting markdown to structured JSON
4. `generating_ai_callouts` - Groq Kimi-k2 generating contextual callout texts (parallel)
5. `generating_ai_summary` - Groq Kimi-k2 generating enhanced paragraph summary
6. `constructing_html` - Building complete HTML document structure
7. `injecting_callouts` - Inserting AI-generated callouts into HTML after H2 sections
8. `finalizing_html` - Final HTML validation and formatting
9. `generating_schema` - Groq gpt-oss-120b generating comprehensive JSON-LD schema with reasoning
10. `saving_to_database` - Writing all generated data to task record
11. `completed` - Success (all data saved: markdown, JSON, HTML, schema)
12. `failed` - Error occurred (check message field for details)

---

## 🐛 Troubleshooting

### Common Issues

**"Outline not found"**
- Verify outline_guid exists in `content_plan_outlines` table
- Check that outline has valid `outline_sections` data

**"No callouts generated"**
- Check GROQ_API_KEY is set
- Verify domain preferences are loaded
- Check H2 sections aren't all excluded (summary, TOC, etc.)

**"HTML too short"**
- Check markdown generation succeeded
- Verify JSON conversion has sections
- Check for errors in Claude API calls

**"Callouts not appearing"**
- Verify callout templates exist in pairs table for domain
- Check callout texts were generated (see logs)
- Ensure H2 sections have proper IDs

---

## 📈 Performance

- **Markdown Generation**: ~5-10 seconds (Claude API)
- **JSON Conversion**: ~3-5 seconds (Claude API)
- **Callout Generation**: ~2-4 seconds per section (Groq Kimi-k2, parallel)
- **HTML Construction**: <1 second (synchronous)
- **Total Time**: ~15-30 seconds for typical blog post

---

## 🎉 Success Criteria

A successful run should produce:
- ✅ Task record with status = `completed`
- ✅ `unedited_content` field populated with markdown
- ✅ `post_json` field populated with structured JSON
- ✅ `post_html` field populated with complete HTML
- ✅ `content` field populated with HTML (duplicate for compatibility)
- ✅ Callouts injected after each H2 section
- ✅ Enhanced summary in summary section
- ✅ All preferences applied (styles, CTAs, social icons)

---

## 📚 Related Documentation

- [CLAUDE.md](/Users/martinbowling/Projects/pp-supabase/CLAUDE.md) - Project overview
- [Fast Mode Outline](/Users/martinbowling/Projects/pp-supabase/supabase/functions/README-FAST-MODE-OUTLINE.md) - Fast outline generation
- [Groq Logging Utility](/Users/martinbowling/Projects/pp-supabase/supabase/functions/utils/groq-logging.ts) - Groq API wrapper

---

## 🤝 Contributing

When modifying this function:

1. Update types in `types.ts` if changing data structures
2. Add new preferences to `preferences-loader.ts` defaults
3. Test callout generation with various section types
4. Verify HTML output renders correctly
5. Check task status progression is logical
6. Update this README with any new features

---

## 📝 License

Part of the PlanPerfect / ContentPerfect system.
Proprietary - All rights reserved.
