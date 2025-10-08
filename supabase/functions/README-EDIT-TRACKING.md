# Enhanced Edit Tracking System

This document outlines the enhanced edit tracking system implemented for the editPerfect feature, which allows tracking, management, and selective application of individual content edits.

## Overview

The enhanced edit tracking system addresses the need to save each individual edit made to content during the editPerfect process, rather than only capturing the final result. This approach provides several benefits:

1. **Granular Control**: Content editors can view, evaluate, and selectively apply specific edits.
2. **Edit History**: A comprehensive record of all changes is maintained, enabling better audit trails.
3. **Edit Analytics**: Statistics on edit types, frequencies, and patterns can be analyzed.
4. **Selective Application**: Not all suggested edits need to be applied; editors can choose which ones to implement.

## Database Schema

### Core Tables

#### `content_edits` Table

Stores individual edits with their original and edited text versions:

```sql
CREATE TABLE IF NOT EXISTS "content_edits" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "job_id" UUID NOT NULL REFERENCES "edit_jobs"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "version_id" UUID REFERENCES "document_versions"("id") ON DELETE SET NULL,
  "edit_type" TEXT NOT NULL CHECK ("edit_type" IN ('style', 'redundancy', 'feedback', 'manual')),
  "paragraph_number" INTEGER,
  "original_text" TEXT NOT NULL,
  "edited_text" TEXT NOT NULL,
  "reasoning" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "is_applied" BOOLEAN NOT NULL DEFAULT FALSE,
  "applied_at" TIMESTAMPTZ,
  "approved_by" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE
);
```

#### `applied_edits` Junction Table

Links edits to document versions when they are applied:

```sql
CREATE TABLE IF NOT EXISTS "applied_edits" (
  "version_id" UUID NOT NULL REFERENCES "document_versions"("id") ON DELETE CASCADE,
  "edit_id" UUID NOT NULL REFERENCES "content_edits"("id") ON DELETE CASCADE,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("version_id", "edit_id")
);
```

### Database Triggers

The system includes triggers to automatically update edit status:

```sql
CREATE OR REPLACE FUNCTION update_edit_applied_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE content_edits
  SET is_applied = TRUE, applied_at = NOW()
  WHERE id = NEW.edit_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_edit_applied
AFTER INSERT ON applied_edits
FOR EACH ROW
EXECUTE FUNCTION update_edit_applied_status();
```

### RPC Function for Edit Counts

Retrieves statistics on edits by type:

```sql
CREATE OR REPLACE FUNCTION get_edit_counts_by_type(job_id_param UUID)
RETURNS TABLE (
  edit_type TEXT,
  count BIGINT
) 
LANGUAGE SQL
AS $$
  SELECT edit_type, COUNT(*) as count
  FROM content_edits
  WHERE job_id = job_id_param AND is_deleted = FALSE
  GROUP BY edit_type ORDER BY edit_type;
$$;
```

## Edge Functions

### Modified Functions

#### `process-style-transformation`

Modified to store individual style edits:

```typescript
// Apply the edits to the content and get details of applied edits
const { content: transformedContent, appliedEdits } = applyEdits(contentToEdit, editsJson);
editedContent = transformedContent;

// Store each individual edit in the content_edits table
if (appliedEdits.length > 0) {
  const contentEditsData = appliedEdits.map(edit => ({
    job_id: job_id,
    document_id: editJob.document_id,
    edit_type: 'style',
    paragraph_number: edit.paragraph_number,
    original_text: edit.original_text,
    edited_text: edit.edited_text,
    reasoning: edit.reasoning
  }));
  
  const { data: storedEdits, error: editsStoreError } = await supabase
    .from('content_edits')
    .insert(contentEditsData)
    .select('id');
}
```

#### `process-redundancy-removal`

Modified to store individual redundancy edits:

```typescript
// Similar implementation as style transformation but with edit_type: 'redundancy'
```

#### `get-edit-job-status`

Updated to include edit count information:

```typescript
// Get edit counts by type
const { data: editCounts, error: editCountsError } = await supabase.rpc(
  'get_edit_counts_by_type',
  { job_id_param: job_id }
);

// Include edit counts in the response
return {
  statusCode: 200,
  body: JSON.stringify({
    job: editJob,
    edit_counts: editCounts || []
  })
};
```

### New Functions

#### `get-content-edits`

Retrieves edits with filtering, sorting, and pagination:

```typescript
// Parameters: job_id, edit_type (optional), is_applied (optional), 
// page, limit, sort_by, sort_direction
let query = supabase
  .from('content_edits')
  .select('*', { count: 'exact' })
  .eq('job_id', job_id)
  .eq('is_deleted', false);

// Apply filters if provided
if (edit_type) query = query.eq('edit_type', edit_type);
if (is_applied !== undefined) query = query.eq('is_applied', is_applied);

// Apply sorting
const sortColumn = sort_by || 'created_at';
const sortDir = sort_direction || 'desc';
query = query.order(sortColumn, { ascending: sortDir === 'asc' });

// Apply pagination
const page = parseInt(page_param) || 1;
const limit = parseInt(limit_param) || 10;
const offset = (page - 1) * limit;
query = query.range(offset, offset + limit - 1);

const { data: edits, error, count } = await query;
```

#### `apply-content-edits`

Selectively applies specific edits to create a new version:

```typescript
// Parameters: job_id, edit_ids (array of edit UUIDs)
// Get the edits to apply
const { data: edits, error: editsError } = await supabase
  .from('content_edits')
  .select('*')
  .in('id', edit_ids)
  .order('paragraph_number', { ascending: true });

// Get the original content from the job
const { data: job, error: jobError } = await supabase
  .from('edit_jobs')
  .select('original_content, document_id')
  .eq('id', job_id)
  .single();

// Sort edits by paragraph number
const sortedEdits = [...edits].sort((a, b) => {
  if (a.paragraph_number === null) return 1;
  if (b.paragraph_number === null) return -1;
  return a.paragraph_number - b.paragraph_number;
});

// Apply the edits to the content
let updatedContent = job.original_content;
const appliedEditIds = [];

for (const edit of sortedEdits) {
  if (updatedContent.includes(edit.original_text)) {
    updatedContent = updatedContent.replace(edit.original_text, edit.edited_text);
    appliedEditIds.push(edit.id);
  }
}

// Create a new document version
const { data: newVersion, error: versionError } = await supabase
  .from('document_versions')
  .insert({
    document_id: job.document_id,
    job_id: job_id,
    content: updatedContent,
    version_type: 'selective_edits'
  })
  .select()
  .single();

// Record which edits were applied to this version
if (appliedEditIds.length > 0) {
  const appliedEditsData = appliedEditIds.map(edit_id => ({
    version_id: newVersion.id,
    edit_id: edit_id
  }));
  
  await supabase
    .from('applied_edits')
    .insert(appliedEditsData);
}
```

## UI Implementation

The UI for the enhanced edit tracking system includes:

1. **Edit Statistics Dashboard**: Displays counts of different edit types.
2. **Individual Edits Tab**: A dedicated tab showing all edits with filtering options.
3. **Edit Filtering**: Filters for edit type, application status, and sorting.
4. **Pagination**: Supports browsing large numbers of edits.
5. **Bulk Selection**: Ability to select multiple edits at once.
6. **Selective Application**: Button to apply only selected edits.

### Key UI Features

- **Edit Cards**: Each edit is displayed in a card showing:
  - Edit type (style, redundancy, feedback, manual)
  - Applied status
  - Paragraph number
  - Original text
  - Edited text
  - Reasoning (if available)
  - Creation timestamp
  
- **Filtering Panel**: Controls for filtering and sorting edits:
  - By edit type dropdown
  - By applied status dropdown
  - By creation date or paragraph number

- **Bulk Actions**: Actions for working with multiple edits:
  - Select all checkbox
  - Apply selected edits button
  - Selection counter

## Implementation Flow

1. **Edit Generation**: When edits are generated (style, redundancy, feedback), each individual edit is stored in the `content_edits` table.

2. **Status Tracking**: The job status endpoint is enhanced to include edit counts by type.

3. **Edit Retrieval**: The UI can fetch edits with filtering and pagination.

4. **Selective Application**: Users can select specific edits and apply only those, creating a new version.

5. **Status Update**: When edits are applied, their status is automatically updated via database triggers.

## Benefits and Future Enhancements

### Benefits

- **Transparency**: Complete visibility into all changes made to content.
- **Control**: Editorial teams can selectively apply changes.
- **Quality Assurance**: Ability to review individual edits before application.
- **Analytics**: Insights into edit patterns and frequencies.

### Potential Future Enhancements

- **Edit Categories**: Further categorization of edits beyond the current types.
- **Edit Tags**: Ability to tag edits for organizational purposes.
- **Edit Approval Workflows**: Multi-stage approval process for edits.
- **Edit Templates**: Save common edit patterns as templates.
- **Automated Edit Suggestions**: AI-powered suggestions for edits based on historical data.

## Conclusion

The enhanced edit tracking system provides a robust foundation for granular control over content edits. By tracking each individual edit, the system enables content teams to have complete visibility and control over the editing process, enhancing both efficiency and quality of the final content.