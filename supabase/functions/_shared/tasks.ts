import { supabaseAdmin } from "./client.ts";

function sanitizeUpdates(updates: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );
}

export async function updateLegacyTask(
  outlineGuid: string | undefined,
  updates: Record<string, unknown>,
) {
  if (!outlineGuid) {
    console.warn("updateLegacyTask called without outline guid");
    return;
  }

  const timestamp = new Date().toISOString();
  const payload = sanitizeUpdates({
    ...updates,
    updated_at: timestamp,
    last_updated_at: timestamp,
  });

  const { error } = await supabaseAdmin
    .from("tasks")
    .update(payload)
    .eq("content_plan_outline_guid", outlineGuid);

  if (error) {
    console.error("Failed to update legacy task", outlineGuid, error);
  }
}
