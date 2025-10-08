// Enhanced task lookup function that tries multiple methods
export async function findTaskForOutline(supabase: any, outlineGuid: string) {
  console.log(`Looking for task for outline: ${outlineGuid}`)
  
  // Method 1: Direct lookup by content_plan_outline_guid
  let { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('content_plan_outline_guid', outlineGuid)
    .order('created_at', { ascending: false })

  if (!taskError && tasks && tasks.length > 0) {
    console.log(`Found ${tasks.length} tasks via direct outline_guid lookup`)
    return selectBestTask(tasks)
  }

  // Method 2: Lookup via content_plan_outlines table
  const { data: outline, error: outlineError } = await supabase
    .from('content_plan_outlines')
    .select('task_id, job_id')
    .eq('guid', outlineGuid)
    .single()

  if (!outlineError && outline) {
    // Try to find task by task_id
    if (outline.task_id) {
      const { data: taskByTaskId } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', outline.task_id)
        .single()
      
      if (taskByTaskId) {
        console.log(`Found task via outline.task_id: ${outline.task_id}`)
        return taskByTaskId
      }
    }

    // Try to find task by job_id
    if (outline.job_id) {
      const { data: taskByJobId } = await supabase
        .from('tasks')
        .select('*')
        .eq('task_id', outline.job_id)
        .single()
      
      if (taskByJobId) {
        console.log(`Found task via outline.job_id: ${outline.job_id}`)
        return taskByJobId
      }
    }
  }

  // Method 3: Try finding by matching the task_id to the outline guid itself
  const { data: taskByGuid } = await supabase
    .from('tasks')
    .select('*')
    .eq('task_id', outlineGuid)
    .single()
  
  if (taskByGuid) {
    console.log(`Found task where task_id matches outline guid`)
    return taskByGuid
  }

  // No task found
  console.error(`No task found for outline ${outlineGuid} using any method`)
  return null
}

function selectBestTask(tasks: any[]) {
  // Select the most appropriate task (content task or latest task)
  const task = tasks.find(t => 
    t.task_type === 'content' || 
    t.title?.toLowerCase().includes('content') ||
    (t.content && t.content.trim().length > 100)
  ) || tasks[0]
  
  console.log(`Selected task: ${task.task_id} (type: ${task.task_type || 'unknown'}, content length: ${task.content?.length || 0})`)
  return task
}