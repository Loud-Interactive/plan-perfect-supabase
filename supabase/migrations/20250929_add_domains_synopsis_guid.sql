-- Ensure domains table tracks Synopsis completion details
ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS has_synopsis BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS last_synopsis_guid UUID;

-- Helpful index so lookups by guid stay fast when resuming jobs
CREATE INDEX IF NOT EXISTS domains_last_synopsis_guid_idx
  ON public.domains (last_synopsis_guid);
