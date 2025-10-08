-- Master setup script for outline generation tables
-- This script creates all necessary tables if they don't exist

-- Create outline_generation_jobs table
CREATE TABLE IF NOT EXISTS outline_generation_jobs (
    id SERIAL PRIMARY KEY,
    content_plan_guid UUID,
    post_title TEXT NOT NULL,
    content_plan_keyword TEXT NOT NULL,
    post_keyword TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create outline_search_terms table
CREATE TABLE IF NOT EXISTS outline_search_terms (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES outline_generation_jobs(id),
    search_term TEXT NOT NULL,
    category TEXT DEFAULT 'generic',
    priority INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create outline_search_results table
CREATE TABLE IF NOT EXISTS outline_search_results (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES outline_generation_jobs(id),
    search_term TEXT NOT NULL,
    search_category TEXT,
    search_priority INTEGER,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    "publishedTime" TEXT,
    date TEXT,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create outline_url_analyses table
CREATE TABLE IF NOT EXISTS outline_url_analyses (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES outline_generation_jobs(id),
    url TEXT NOT NULL,
    title TEXT,
    headings JSONB,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create content_plan_outlines_ai table
CREATE TABLE IF NOT EXISTS content_plan_outlines_ai (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES outline_generation_jobs(id),
    outline JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comments to document the purpose of tables
COMMENT ON TABLE outline_generation_jobs IS 'Stores information about outline generation jobs';
COMMENT ON TABLE outline_search_terms IS 'Stores search terms used for each outline generation job';
COMMENT ON TABLE outline_search_results IS 'Stores search results from Jina.ai API';
COMMENT ON TABLE outline_url_analyses IS 'Stores analysis of the URLs and their heading structures';
COMMENT ON TABLE content_plan_outlines_ai IS 'Stores the generated outlines';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_outline_job_id ON outline_generation_jobs(id);
CREATE INDEX IF NOT EXISTS idx_search_terms_job_id ON outline_search_terms(job_id);
CREATE INDEX IF NOT EXISTS idx_search_results_job_id ON outline_search_results(job_id);
CREATE INDEX IF NOT EXISTS idx_url_analyses_job_id ON outline_url_analyses(job_id);
CREATE INDEX IF NOT EXISTS idx_outlines_ai_job_id ON content_plan_outlines_ai(job_id);