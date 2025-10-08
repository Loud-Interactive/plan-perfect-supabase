-- Synopsis Fast Pipeline support

-- Track origin of synopsis jobs (standard vs fast)
ALTER TABLE public.synopsis_jobs
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'standard';

-- Store raw fast-fetch payloads for auditing and retries
CREATE TABLE IF NOT EXISTS public.synopsis_fast_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.synopsis_jobs(id) ON DELETE CASCADE,
  domain text NOT NULL,
  raw_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS synopsis_fast_results_job_id_idx
  ON public.synopsis_fast_results (job_id);

CREATE INDEX IF NOT EXISTS synopsis_jobs_source_idx
  ON public.synopsis_jobs (source);
