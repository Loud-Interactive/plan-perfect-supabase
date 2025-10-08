-- Create a function to check and fix synopsis job progress
CREATE OR REPLACE FUNCTION check_and_fix_synopsis_progress()
RETURNS TRIGGER AS $$
DECLARE
    v_actual_completed INTEGER;
    v_job_record RECORD;
BEGIN
    -- Only process if a page task was just completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- Get the job details
        SELECT * INTO v_job_record 
        FROM synopsis_jobs 
        WHERE id = NEW.job_id;
        
        -- Count actual completed tasks
        SELECT COUNT(*) INTO v_actual_completed
        FROM synopsis_page_tasks
        WHERE job_id = NEW.job_id
        AND status = 'completed';
        
        -- Update the job with the correct count
        UPDATE synopsis_jobs 
        SET 
            completed_pages = v_actual_completed,
            updated_at = NOW()
        WHERE id = NEW.job_id;
        
        -- Check if all pages are now completed
        IF v_actual_completed >= v_job_record.total_pages AND v_job_record.status = 'processing' THEN
            -- Log for debugging
            RAISE NOTICE 'All pages completed for job %, triggering analysis phase', NEW.job_id;
            
            -- Update job to indicate ready for analysis
            UPDATE synopsis_jobs 
            SET 
                status = 'pages_completed',
                updated_at = NOW()
            WHERE id = NEW.job_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on synopsis_page_tasks
DROP TRIGGER IF EXISTS fix_synopsis_progress_trigger ON synopsis_page_tasks;
CREATE TRIGGER fix_synopsis_progress_trigger
AFTER UPDATE ON synopsis_page_tasks
FOR EACH ROW
EXECUTE FUNCTION check_and_fix_synopsis_progress();

-- Create a function to check stuck jobs (can be called periodically)
CREATE OR REPLACE FUNCTION check_stuck_synopsis_jobs()
RETURNS TABLE(job_id UUID, status TEXT, action_taken TEXT) AS $$
DECLARE
    v_job RECORD;
    v_actual_completed INTEGER;
    v_action TEXT;
BEGIN
    -- Find jobs that might be stuck
    FOR v_job IN 
        SELECT sj.* 
        FROM synopsis_jobs sj
        WHERE sj.status = 'processing'
        AND sj.updated_at < NOW() - INTERVAL '5 minutes'
    LOOP
        -- Count actual completed tasks
        SELECT COUNT(*) INTO v_actual_completed
        FROM synopsis_page_tasks
        WHERE job_id = v_job.id
        AND status = 'completed';
        
        v_action := 'none';
        
        -- Fix the count if it's wrong
        IF v_actual_completed != v_job.completed_pages THEN
            UPDATE synopsis_jobs 
            SET 
                completed_pages = v_actual_completed,
                updated_at = NOW()
            WHERE id = v_job.id;
            v_action := 'fixed_count';
        END IF;
        
        -- Check if all pages are actually done
        IF v_actual_completed >= v_job.total_pages THEN
            UPDATE synopsis_jobs 
            SET 
                status = 'pages_completed',
                updated_at = NOW()
            WHERE id = v_job.id;
            v_action := v_action || ',marked_pages_completed';
        END IF;
        
        job_id := v_job.id;
        status := v_job.status;
        action_taken := v_action;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Add a pages_completed status to track when ready for analysis
ALTER TABLE synopsis_jobs 
ADD CONSTRAINT synopsis_jobs_status_check 
CHECK (status IN ('pending', 'processing', 'pages_completed', 'analyzing', 'completed', 'failed', 'partially_completed'));