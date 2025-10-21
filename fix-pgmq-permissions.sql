-- Fix pgmq permissions for edge functions and service role
-- This allows content-intake and workers to access pgmq queues

-- Grant usage on pgmq schema
GRANT USAGE ON SCHEMA pgmq TO postgres, anon, authenticated, service_role;

-- Grant execute on all functions in pgmq schema
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO postgres, anon, authenticated, service_role;

-- Grant access to all tables in pgmq schema
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO postgres, service_role;

-- Grant access to all sequences in pgmq schema
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO postgres, service_role;

-- Ensure future objects also get permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pgmq GRANT ALL ON SEQUENCES TO postgres, service_role;

-- Verify permissions (this should return results, not errors)
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables 
WHERE schemaname = 'pgmq'
LIMIT 5;

