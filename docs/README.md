# Documentation Directory

Welcome to the pp-supabase platform documentation. This directory contains comprehensive technical documentation for all major systems.

## 📚 Documentation Index

### Complete System Documentation

| Document | Description | What You'll Learn |
|----------|-------------|-------------------|
| **[SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md)** | High-level overview of all systems | System purposes, flows, and integration patterns |
| **[PLANPERFECT-SYSTEM.md](./PLANPERFECT-SYSTEM.md)** | Content generation pipeline | Worker architecture, queue management, multi-stage pipeline |
| **[PAGEPERFECT-SYSTEM.md](./PAGEPERFECT-SYSTEM.md)** | SEO optimization system | Vector embeddings, DBSCAN clustering, content gap analysis |

### Quick Reference Guides

| Document | Description |
|----------|-------------|
| [outline-fast-readme.md](../outline-fast-readme.md) | Next.js integration for fast mode outlines |
| [README-FAST-MODE-OUTLINE.md](../supabase/functions/README-FAST-MODE-OUTLINE.md) | Fast mode outline generation technical docs |

## 🎯 Start Here

### New to the Platform?
Start with **[SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md)** to understand:
- What each system does
- How systems integrate
- Basic workflows
- Quick examples

### Working on Specific Systems?

**Content Generation**:
- [PLANPERFECT-SYSTEM.md](./PLANPERFECT-SYSTEM.md) - Multi-stage content pipeline
- [SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md#outline-generation-system) - Outline generation (fast & slow)

**SEO Optimization**:
- [PAGEPERFECT-SYSTEM.md](./PAGEPERFECT-SYSTEM.md) - Full PagePerfect workflow
- [SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md#gsc-integration-system) - GSC integration

**Integrations**:
- [SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md#shopify-integration-system) - Shopify publishing
- [SYSTEMS-OVERVIEW.md](./SYSTEMS-OVERVIEW.md#keyword-classification-system) - Keyword classification

## 📖 What Each Document Contains

### SYSTEMS-OVERVIEW.md
- ✅ All 7 major systems explained
- ✅ Flow charts for each system
- ✅ Key code snippets
- ✅ Integration patterns
- ✅ Performance benchmarks
- ✅ Quick reference tables

**Best for**: Getting a broad understanding or quick reference.

### PLANPERFECT-SYSTEM.md
- ✅ Detailed worker architecture
- ✅ Queue management (pgmq)
- ✅ Error handling & retries
- ✅ Database schema
- ✅ Fire-and-forget pattern
- ✅ Status tracking
- ✅ Integration examples
- ✅ Monitoring queries

**Best for**: Deep dive into content generation pipeline.

### PAGEPERFECT-SYSTEM.md
- ✅ GSC data ingestion
- ✅ Vector embedding generation
- ✅ DBSCAN clustering algorithm
- ✅ Content gap detection
- ✅ Opportunity scoring formula
- ✅ Workflow orchestration
- ✅ Performance optimization
- ✅ Debugging queries

**Best for**: Understanding SEO optimization and vector analysis.

## 🔍 Finding What You Need

### By Use Case

**"I want to generate content"**
→ [PLANPERFECT-SYSTEM.md](./PLANPERFECT-SYSTEM.md) + [Outline Generation](./SYSTEMS-OVERVIEW.md#outline-generation-system)

**"I want to optimize existing content for SEO"**
→ [PAGEPERFECT-SYSTEM.md](./PAGEPERFECT-SYSTEM.md)

**"I want to publish to Shopify"**
→ [Shopify Integration](./SYSTEMS-OVERVIEW.md#shopify-integration-system)

**"I want to use fast mode outlines in Next.js"**
→ [outline-fast-readme.md](../outline-fast-readme.md)

**"I want to understand the GSC API integration"**
→ [PAGEPERFECT-SYSTEM.md](./PAGEPERFECT-SYSTEM.md#step-1-gsc-data-ingestion) + [GSC Integration](./SYSTEMS-OVERVIEW.md#gsc-integration-system)

### By Feature

**Queue-Based Processing**
→ [PLANPERFECT-SYSTEM.md - Queue Management](./PLANPERFECT-SYSTEM.md#queue-management-pgmq)

**Vector Embeddings**
→ [PAGEPERFECT-SYSTEM.md - Content Segmentation](./PAGEPERFECT-SYSTEM.md#step-3-content-segmentation--embedding)

**Semantic Clustering**
→ [PAGEPERFECT-SYSTEM.md - Keyword Clustering](./PAGEPERFECT-SYSTEM.md#step-4-keyword-clustering)

**Workflow Orchestration**
→ [PAGEPERFECT-SYSTEM.md - Workflow Orchestration](./PAGEPERFECT-SYSTEM.md#step-6-workflow-orchestration)

**Fast vs Slow Mode**
→ [SYSTEMS-OVERVIEW.md - Outline Generation](./SYSTEMS-OVERVIEW.md#outline-generation-system)

## 🛠️ Common Tasks

### Deploy a System

```bash
# Fast mode outline
./deploy-fast-mode.sh

# Specific function
supabase functions deploy <function-name> --project-ref jsypctdhynsdqrfifvdh

# All functions
supabase functions deploy --project-ref jsypctdhynsdqrfifvdh
```

See: [Deployment Scripts](./SYSTEMS-OVERVIEW.md#deployment-scripts)

### Monitor System Health

```sql
-- Check job status (PlanPerfect)
SELECT status, stage, COUNT(*)
FROM content_jobs
GROUP BY status, stage;

-- Check outline generation status
SELECT status, COUNT(*)
FROM outline_generation_jobs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Check GSC data freshness
SELECT MAX(fetched_date), COUNT(*)
FROM gsc_page_query;
```

See: [PLANPERFECT-SYSTEM.md - Monitoring](./PLANPERFECT-SYSTEM.md#monitoring--debugging)

### Debug Failed Jobs

```sql
-- Get error details (PlanPerfect)
SELECT job_id, stage, error_message
FROM content_stages
WHERE status = 'failed'
ORDER BY started_at DESC;

-- Get event log
SELECT event_type, message, created_at
FROM content_events
WHERE job_id = 'your-job-id'
ORDER BY created_at DESC;
```

See: [PLANPERFECT-SYSTEM.md - Common Issues](./PLANPERFECT-SYSTEM.md#common-issues)

## 📊 System Comparison

| System | Primary Use | Processing Time | Key Technology |
|--------|-------------|-----------------|----------------|
| **PlanPerfect** | Content creation | 10-20 min (8-12 fast) | Queue workers, Claude |
| **PagePerfect** | SEO optimization | 1-3 min (cached 24h) | Vector embeddings, DBSCAN |
| **Outline Generation (Slow)** | Detailed outlines | 10-20 min | Claude Extended Thinking |
| **Outline Generation (Fast)** | Quick outlines | 2-5 min | Groq gpt-oss-120b |
| **EditPerfect** | Content editing | 2-5 min | AI editing, style guides |
| **GSC Integration** | Data ingestion | 1-5 min | Google APIs |
| **Shopify Integration** | Publishing | < 1 min | Shopify Admin API |

## 🔗 External Resources

### APIs Used
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings) - Vector embeddings
- [Anthropic Claude](https://docs.anthropic.com/claude/reference) - Content generation
- [Groq](https://console.groq.com/docs) - Fast mode outlines
- [Google Search Console](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) - GSC data
- [Shopify Admin API](https://shopify.dev/docs/api/admin-rest) - Publishing

### Supabase Features
- [Edge Functions](https://supabase.com/docs/guides/functions) - Serverless functions
- [pgvector](https://github.com/pgvector/pgvector) - Vector similarity search
- [pgmq](https://github.com/tembo-io/pgmq) - PostgreSQL message queue

## 💡 Tips

### Documentation Best Practices

1. **Start Broad, Go Deep**: Begin with SYSTEMS-OVERVIEW.md, then dive into specific system docs
2. **Use Flow Charts**: Visual diagrams help understand complex workflows
3. **Check Examples**: Look for code examples in each doc
4. **Cross-Reference**: Links between docs help navigate related topics

### Getting Help

1. **Check the docs** first (you're here!)
2. **Review function logs** in Supabase dashboard
3. **Query the database** for status and errors
4. **Check CLAUDE.md** for development commands

## 📝 Contributing to Docs

When adding new features:

1. Update the relevant system doc (PLANPERFECT, PAGEPERFECT, etc.)
2. Add overview to SYSTEMS-OVERVIEW.md
3. Update this README if new major system
4. Include:
   - Flow charts
   - Key code snippets
   - Database schema changes
   - Example usage
   - Performance notes

---

**Last Updated**: 2025-10-10

**Documentation Version**: 1.0

**Platform Version**: See package.json or git tags
