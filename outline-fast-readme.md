# Fast Mode Outline Generation - Next.js Integration Guide

This guide shows you how to use the fast mode outline generation feature in your Next.js application.

## Table of Contents

- [Quick Start](#quick-start)
- [Basic Example](#basic-example)
- [React Hook Example](#react-hook-example)
- [Server-Side Example (App Router)](#server-side-example-app-router)
- [Status Polling](#status-polling)
- [Error Handling](#error-handling)
- [TypeScript Types](#typescript-types)

## Quick Start

Fast mode reduces outline generation time from 10-20 minutes to 2-5 minutes by using Groq's AI instead of the traditional 3-function pipeline.

**Key Benefits**:
- ⚡ 4-8x faster generation
- 🎯 Brand-aware search and generation
- 💰 ~5x cost reduction
- 🧠 Autonomous search strategy
- 📚 Rich data extraction (headings, quotes, markdown)

## Basic Example

### Simple API Call

```typescript
// app/actions/outline.ts
'use server'

import { createClient } from '@/lib/supabase/server'

export async function generateOutlineFast({
  postTitle,
  postKeyword,
  contentPlanKeyword,
  domain,
}: {
  postTitle: string
  postKeyword: string
  contentPlanKeyword: string
  domain: string
}) {
  const supabase = createClient()

  const { data, error } = await supabase.functions.invoke('generate-outline', {
    body: {
      post_title: postTitle,
      post_keyword: postKeyword,
      content_plan_keyword: contentPlanKeyword,
      domain: domain,
      fast: true, // Enable fast mode!
    },
  })

  if (error) throw error

  return {
    jobId: data.job_id,
    success: data.success,
    message: data.message,
  }
}
```

### Component Usage

```tsx
// app/components/OutlineGenerator.tsx
'use client'

import { useState } from 'react'
import { generateOutlineFast } from '@/app/actions/outline'

export function OutlineGenerator() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await generateOutlineFast({
        postTitle: 'Best Protein Shakes for Muscle Building',
        postKeyword: 'best protein shakes muscle building',
        contentPlanKeyword: 'protein shakes',
        domain: 'centr.com',
      })

      setJobId(result.jobId)
      console.log('✅ Fast mode job created:', result.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate outline')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Outline (Fast Mode)'}
      </button>

      {error && (
        <div className="p-3 bg-red-50 text-red-800 rounded">{error}</div>
      )}

      {jobId && (
        <div className="p-3 bg-green-50 text-green-800 rounded">
          Job created: {jobId}
        </div>
      )}
    </div>
  )
}
```

## React Hook Example

### Custom Hook for Outline Generation

```typescript
// hooks/useOutlineGeneration.ts
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface GenerateOutlineParams {
  postTitle: string
  postKeyword: string
  contentPlanKeyword: string
  domain: string
  fast?: boolean
}

interface OutlineStatus {
  status: string
  created_at: string
}

export function useOutlineGeneration() {
  const [jobId, setJobId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<any>(null)
  const [statuses, setStatuses] = useState<OutlineStatus[]>([])

  const supabase = createClient()

  const generate = useCallback(
    async (params: GenerateOutlineParams) => {
      setLoading(true)
      setError(null)
      setJobId(null)
      setOutline(null)
      setStatuses([])

      try {
        const { data, error } = await supabase.functions.invoke(
          'generate-outline',
          {
            body: {
              post_title: params.postTitle,
              post_keyword: params.postKeyword,
              content_plan_keyword: params.contentPlanKeyword,
              domain: params.domain,
              fast: params.fast ?? true, // Default to fast mode
            },
          }
        )

        if (error) throw error

        setJobId(data.job_id)
        return data.job_id
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [supabase]
  )

  const pollStatus = useCallback(
    async (jobIdToPoll: string) => {
      try {
        const { data, error } = await supabase
          .from('content_plan_outline_statuses')
          .select('status, created_at')
          .eq('outline_guid', jobIdToPoll)
          .order('created_at', { ascending: false })

        if (error) throw error

        setStatuses(data || [])

        // Check if completed
        if (data?.[0]?.status === 'completed') {
          // Fetch the final outline
          const { data: outlineData, error: outlineError } = await supabase
            .from('content_plan_outlines')
            .select('outline')
            .eq('guid', jobIdToPoll)
            .single()

          if (!outlineError && outlineData) {
            const parsedOutline =
              typeof outlineData.outline === 'string'
                ? JSON.parse(outlineData.outline)
                : outlineData.outline

            setOutline(parsedOutline)
            return { completed: true, outline: parsedOutline }
          }
        }

        return { completed: false, statuses: data }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Polling failed'
        setError(message)
        throw err
      }
    },
    [supabase]
  )

  const reset = useCallback(() => {
    setJobId(null)
    setLoading(false)
    setError(null)
    setOutline(null)
    setStatuses([])
  }, [])

  return {
    generate,
    pollStatus,
    reset,
    jobId,
    loading,
    error,
    outline,
    statuses,
  }
}
```

### Using the Hook

```tsx
// app/components/OutlineGeneratorWithPolling.tsx
'use client'

import { useState, useEffect } from 'react'
import { useOutlineGeneration } from '@/hooks/useOutlineGeneration'

export function OutlineGeneratorWithPolling() {
  const { generate, pollStatus, jobId, loading, error, outline, statuses } =
    useOutlineGeneration()
  const [polling, setPolling] = useState(false)

  useEffect(() => {
    if (!jobId || outline) return

    setPolling(true)
    const interval = setInterval(async () => {
      try {
        const result = await pollStatus(jobId)
        if (result.completed) {
          setPolling(false)
          clearInterval(interval)
        }
      } catch (err) {
        console.error('Polling error:', err)
        setPolling(false)
        clearInterval(interval)
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, [jobId, outline, pollStatus])

  const handleGenerate = async () => {
    try {
      await generate({
        postTitle: 'Best Protein Shakes for Muscle Building',
        postKeyword: 'best protein shakes muscle building',
        contentPlanKeyword: 'protein shakes',
        domain: 'centr.com',
        fast: true,
      })
    } catch (err) {
      console.error('Generation error:', err)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Fast Mode Outline Generator</h2>
        <button
          onClick={handleGenerate}
          disabled={loading || polling}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading || polling ? 'Processing...' : 'Generate Outline'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded">
          ❌ {error}
        </div>
      )}

      {jobId && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="font-mono text-sm text-blue-900">Job ID: {jobId}</p>
        </div>
      )}

      {statuses.length > 0 && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded">
          <h3 className="font-semibold mb-2">Status Updates:</h3>
          <div className="space-y-1">
            {statuses.slice(0, 5).map((status, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-gray-500">
                  {new Date(status.created_at).toLocaleTimeString()}
                </span>
                <span className="font-medium">{status.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {outline && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <h3 className="text-xl font-semibold mb-4 text-green-900">
            ✅ Outline Generated
          </h3>
          <div className="space-y-4">
            <h4 className="text-lg font-bold">{outline.title}</h4>
            {outline.sections?.map((section: any, i: number) => (
              <div key={i} className="pl-4 border-l-2 border-green-300">
                <h5 className="font-semibold text-green-900">
                  {section.title}
                </h5>
                <ul className="list-disc list-inside text-sm text-gray-700 mt-1">
                  {section.subheadings?.map((sub: string, j: number) => (
                    <li key={j}>{sub}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {polling && (
        <div className="flex items-center justify-center gap-2 text-blue-600">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
          <span>Generating outline...</span>
        </div>
      )}
    </div>
  )
}
```

## Server-Side Example (App Router)

### Server Action with Status Monitoring

```typescript
// app/actions/outline-server.ts
'use server'

import { createClient } from '@/lib/supabase/server'

export async function generateOutlineServerSide({
  postTitle,
  postKeyword,
  contentPlanKeyword,
  domain,
  contentPlanGuid,
}: {
  postTitle: string
  postKeyword: string
  contentPlanKeyword: string
  domain: string
  contentPlanGuid?: string
}) {
  const supabase = createClient()

  // Step 1: Create the outline generation job
  const { data, error } = await supabase.functions.invoke('generate-outline', {
    body: {
      post_title: postTitle,
      post_keyword: postKeyword,
      content_plan_keyword: contentPlanKeyword,
      content_plan_guid: contentPlanGuid,
      domain: domain,
      fast: true, // Enable fast mode
    },
  })

  if (error) {
    throw new Error(`Failed to create outline job: ${error.message}`)
  }

  return data.job_id
}

export async function getOutlineStatus(jobId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('content_plan_outline_statuses')
    .select('status, created_at')
    .eq('outline_guid', jobId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch status: ${error.message}`)
  }

  return data
}

export async function getOutlineResult(jobId: string) {
  const supabase = createClient()

  // Check if completed
  const { data: statusData } = await supabase
    .from('content_plan_outline_statuses')
    .select('status')
    .eq('outline_guid', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (statusData?.status !== 'completed') {
    return null
  }

  // Fetch the outline
  const { data: outlineData, error } = await supabase
    .from('content_plan_outlines')
    .select('outline, status, updated_at')
    .eq('guid', jobId)
    .single()

  if (error) {
    throw new Error(`Failed to fetch outline: ${error.message}`)
  }

  return {
    outline:
      typeof outlineData.outline === 'string'
        ? JSON.parse(outlineData.outline)
        : outlineData.outline,
    status: outlineData.status,
    updatedAt: outlineData.updated_at,
  }
}
```

### Server Component Page

```tsx
// app/outline/[jobId]/page.tsx
import { getOutlineResult, getOutlineStatus } from '@/app/actions/outline-server'
import { notFound } from 'next/navigation'

export default async function OutlinePage({
  params,
}: {
  params: { jobId: string }
}) {
  const outline = await getOutlineResult(params.jobId)

  if (!outline) {
    // Still processing
    const statuses = await getOutlineStatus(params.jobId)

    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Outline Generation in Progress</h1>
        <div className="space-y-2">
          {statuses.map((status, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-gray-500">
                {new Date(status.created_at).toLocaleTimeString()}
              </span>
              <span>{status.status}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-gray-600">
          Refresh this page to check for updates. Fast mode typically completes in 2-5 minutes.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">{outline.outline.title}</h1>
      <div className="space-y-6">
        {outline.outline.sections?.map((section: any, i: number) => (
          <div key={i} className="border-l-4 border-blue-500 pl-4">
            <h2 className="text-xl font-semibold mb-2">{section.title}</h2>
            <ul className="space-y-1">
              {section.subheadings?.map((sub: string, j: number) => (
                <li key={j} className="text-gray-700">
                  • {sub}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-8 text-sm text-gray-500">
        Generated: {new Date(outline.updatedAt).toLocaleString()}
      </div>
    </div>
  )
}
```

## Status Polling

### Real-time Status Updates with Supabase Realtime

```typescript
// hooks/useOutlineRealtime.ts
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useOutlineRealtime(jobId: string | null) {
  const [statuses, setStatuses] = useState<any[]>([])
  const [outline, setOutline] = useState<any>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!jobId) return

    // Subscribe to status updates
    const statusChannel = supabase
      .channel(`outline-status-${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'content_plan_outline_statuses',
          filter: `outline_guid=eq.${jobId}`,
        },
        (payload) => {
          setStatuses((prev) => [payload.new, ...prev])

          // If completed, fetch the outline
          if (payload.new.status === 'completed') {
            fetchOutline()
          }
        }
      )
      .subscribe()

    // Fetch initial statuses
    fetchStatuses()

    return () => {
      statusChannel.unsubscribe()
    }
  }, [jobId])

  const fetchStatuses = async () => {
    if (!jobId) return

    const { data } = await supabase
      .from('content_plan_outline_statuses')
      .select('*')
      .eq('outline_guid', jobId)
      .order('created_at', { ascending: false })

    if (data) {
      setStatuses(data)
    }
  }

  const fetchOutline = async () => {
    if (!jobId) return

    const { data } = await supabase
      .from('content_plan_outlines')
      .select('outline')
      .eq('guid', jobId)
      .single()

    if (data) {
      setOutline(
        typeof data.outline === 'string' ? JSON.parse(data.outline) : data.outline
      )
    }
  }

  return { statuses, outline }
}
```

## Error Handling

### Handling Fast Mode Fallback

```typescript
// app/actions/outline-with-fallback.ts
'use server'

import { createClient } from '@/lib/supabase/server'

export async function generateOutlineWithFallback({
  postTitle,
  postKeyword,
  contentPlanKeyword,
  domain,
}: {
  postTitle: string
  postKeyword: string
  contentPlanKeyword: string
  domain: string
}) {
  const supabase = createClient()

  const { data, error } = await supabase.functions.invoke('generate-outline', {
    body: {
      post_title: postTitle,
      post_keyword: postKeyword,
      content_plan_keyword: contentPlanKeyword,
      domain: domain,
      fast: true,
    },
  })

  if (error) {
    throw new Error(`Outline generation failed: ${error.message}`)
  }

  const jobId = data.job_id

  // Wait a bit and check if fast mode failed
  await new Promise((resolve) => setTimeout(resolve, 5000))

  const { data: statusData } = await supabase
    .from('content_plan_outline_statuses')
    .select('status')
    .eq('outline_guid', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const status = statusData?.status || ''

  return {
    jobId,
    mode: status.includes('fast') ? 'fast' : status.includes('slow') ? 'slow' : 'unknown',
    fallbackActivated: status === 'fast_mode_failed_retrying_slow',
  }
}
```

## TypeScript Types

```typescript
// types/outline.ts

export interface OutlineGenerationParams {
  post_title: string
  post_keyword: string
  content_plan_keyword: string
  content_plan_guid?: string
  domain: string
  fast?: boolean
}

export interface OutlineGenerationResponse {
  success: boolean
  message: string
  job_id: string
}

export interface OutlineStatus {
  outline_guid: string
  status: string
  created_at: string
}

export interface OutlineSection {
  title: string
  subheadings: string[]
}

export interface Outline {
  title: string
  sections: OutlineSection[]
}

export interface OutlineResult {
  guid: string
  outline: Outline
  status: 'completed' | 'failed' | 'processing'
  updated_at: string
  created_at: string
}

// Fast mode specific statuses
export type FastModeStatus =
  | 'fast_search_started'
  | 'fetching_brand_profile'
  | 'brand_profile_retrieved'
  | 'using_default_brand_profile'
  | 'initiating_intelligent_search'
  | 'groq_search_in_progress'
  | 'parsing_search_results'
  | 'saving_10_search_results'
  | 'fast_search_completed'
  | 'analyzing_article_data'
  | 'generating_outline_with_groq'
  | 'parsing_outline_response'
  | 'saving_outline'
  | 'completed'
  | 'fast_search_error'
  | 'fast_analysis_error'
  | 'fast_mode_failed_retrying_slow'
```

## Environment Setup

### .env.local

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jsypctdhynsdqrfifvdh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

### Supabase Client Setup

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

```typescript
// lib/supabase/server.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // Server component
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // Server component
          }
        },
      },
    }
  )
}
```

## Performance Tips

1. **Use Fast Mode by Default**: Set `fast: true` for 80% faster generation
2. **Poll Efficiently**: Use 3-5 second intervals, not real-time updates
3. **Cache Results**: Store completed outlines in your database
4. **Show Progress**: Display status updates to keep users engaged
5. **Handle Fallback**: Fast mode automatically falls back to slow mode on errors

## Troubleshooting

### Fast Mode Not Working

Check if `GROQ_API_KEY` is set:

```bash
supabase secrets list --project-ref jsypctdhynsdqrfifvdh
```

### Status Shows Error

Check the status for error messages:

```typescript
const { data } = await supabase
  .from('content_plan_outline_statuses')
  .select('status')
  .eq('outline_guid', jobId)
  .order('created_at', { ascending: false })

// Look for statuses like:
// - 'fast_search_error: <message>'
// - 'fast_analysis_error: <message>'
// - 'fast_mode_failed_retrying_slow'
```

### Outline Takes Too Long

Fast mode should complete in 2-5 minutes. If it takes longer:
1. Check if it fell back to slow mode (10-20 minutes)
2. Monitor statuses to see where it's stuck
3. Check function logs in Supabase dashboard

## Additional Resources

- [Fast Mode Technical Documentation](./supabase/functions/README-FAST-MODE-OUTLINE.md)
- [Supabase Functions Documentation](https://supabase.com/docs/guides/functions)
- [Groq API Documentation](https://console.groq.com/docs)
