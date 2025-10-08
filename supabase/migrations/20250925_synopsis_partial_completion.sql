-- Allow partial page completion to trigger analysis for Synopsis Perfect
-- Executes when at least min_required_pages (default 5) or 50% of pages are done

CREATE OR REPLACE FUNCTION check_and_fix_synopsis_progress()
RETURNS TRIGGER AS $$
DECLARE
    v_actual_completed INTEGER;
    v_job_record synopsis_jobs%ROWTYPE;
    v_total_pages INTEGER;
    v_required_pages INTEGER;
    v_threshold INTEGER;
    v_status_changed BOOLEAN := FALSE;
    v_partial_label TEXT := NULL;
BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        SELECT * INTO v_job_record
        FROM synopsis_jobs
        WHERE id = NEW.job_id;

        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        SELECT COUNT(*) INTO v_actual_completed
        FROM synopsis_page_tasks
        WHERE job_id = NEW.job_id
          AND status = 'completed';

        UPDATE synopsis_jobs
        SET completed_pages = v_actual_completed,
            updated_at = NOW()
        WHERE id = NEW.job_id;

        v_total_pages := COALESCE(v_job_record.total_pages, 0);
        v_threshold := CEIL(GREATEST(v_total_pages * 0.5, 3));
        v_required_pages := COALESCE(v_job_record.min_required_pages, v_threshold);
        v_required_pages := GREATEST(v_required_pages, 1);

        IF v_total_pages = 0 THEN
            v_total_pages := v_actual_completed;
        END IF;

        IF v_actual_completed >= v_total_pages THEN
            v_status_changed := TRUE;
            v_partial_label := 'complete';
        ELSIF v_job_record.partial_completion_allowed AND v_actual_completed >= v_required_pages THEN
            v_status_changed := TRUE;
            v_partial_label := 'basic';
        END IF;

        IF v_status_changed THEN
            UPDATE synopsis_jobs
            SET status = 'ready_for_analysis',
                partial_status = COALESCE(v_partial_label, partial_status),
                updated_at = NOW()
            WHERE id = NEW.job_id
              AND status <> 'ready_for_analysis';

            IF EXISTS (SELECT 1 FROM synopsis_jobs WHERE id = NEW.job_id AND status = 'ready_for_analysis') THEN
                IF NOT EXISTS (
                    SELECT 1 FROM synopsis_events
                    WHERE job_id = NEW.job_id
                      AND event_type = 'start_analysis'
                      AND processed = FALSE
                ) THEN
                    INSERT INTO synopsis_events (job_id, event_type, event_data)
                    VALUES (
                        NEW.job_id,
                        'start_analysis',
                        jsonb_build_object(
                            'trigger', 'auto_threshold',
                            'completed_pages', v_actual_completed,
                            'total_pages', v_total_pages,
                            'min_required_pages', v_required_pages,
                            'partial', v_partial_label IS NOT NULL AND v_partial_label <> 'complete'
                        )
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_stuck_synopsis_jobs()
RETURNS TABLE(job_id UUID, status TEXT, action_taken TEXT) AS $$
DECLARE
    v_job RECORD;
    v_actual_completed INTEGER;
    v_required_pages INTEGER;
    v_total_pages INTEGER;
    v_action TEXT;
BEGIN
    FOR v_job IN
        SELECT sj.*
        FROM synopsis_jobs sj
        WHERE sj.status = 'processing'
          AND sj.updated_at < NOW() - INTERVAL '5 minutes'
    LOOP
        SELECT COUNT(*) INTO v_actual_completed
        FROM synopsis_page_tasks
        WHERE job_id = v_job.id
          AND status = 'completed';

        v_total_pages := COALESCE(v_job.total_pages, 0);
        v_required_pages := COALESCE(
            v_job.min_required_pages,
            CEIL(GREATEST(v_total_pages * 0.5, 3))
        );
        v_required_pages := GREATEST(v_required_pages, 1);

        v_action := 'none';

        IF v_actual_completed <> v_job.completed_pages THEN
            UPDATE synopsis_jobs
            SET completed_pages = v_actual_completed,
                updated_at = NOW()
            WHERE id = v_job.id;
            v_action := 'fixed_count';
        END IF;

        IF v_actual_completed >= v_total_pages AND v_total_pages > 0 THEN
            UPDATE synopsis_jobs
            SET status = 'ready_for_analysis',
                partial_status = 'complete',
                updated_at = NOW()
            WHERE id = v_job.id;
            v_action := v_action || ',marked_ready_full';
        ELSIF v_job.partial_completion_allowed AND v_actual_completed >= v_required_pages THEN
            UPDATE synopsis_jobs
            SET status = 'ready_for_analysis',
                partial_status = 'basic',
                updated_at = NOW()
            WHERE id = v_job.id;
            v_action := v_action || ',marked_ready_partial';
        END IF;

        IF v_action <> 'none' THEN
            IF NOT EXISTS (
                SELECT 1
                FROM synopsis_events
                WHERE job_id = v_job.id
                  AND event_type = 'start_analysis'
                  AND processed = FALSE
            ) THEN
                INSERT INTO synopsis_events (job_id, event_type, event_data)
                VALUES (
                    v_job.id,
                    'start_analysis',
                    jsonb_build_object(
                        'trigger', 'stuck_job_recovery',
                        'completed_pages', v_actual_completed,
                        'total_pages', v_total_pages,
                        'min_required_pages', v_required_pages,
                        'partial', v_actual_completed < v_total_pages
                    )
                );
            END IF;
        END IF;

        job_id := v_job.id;
        status := v_job.status;
        action_taken := v_action;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
