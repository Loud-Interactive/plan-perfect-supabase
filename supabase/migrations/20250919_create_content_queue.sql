DO $$
BEGIN
  PERFORM pgmq.create('content');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM pgmq.create('schema');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM pgmq.create('tsv');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
