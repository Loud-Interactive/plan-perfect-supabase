// Enhanced version of synopsis-page-discovery that uses the scraping coordinator
// This is the updated triggerPageCrawling function

/**
 * Trigger page crawling using the new scraping coordinator
 */
async function triggerPageCrawling(jobId: string): Promise<void> {
  try {
    console.log(`Triggering scraping coordinator for job ${jobId}`)
    
    // Use the new scraping coordinator instead of individual page crawlers
    const response = await fetch(`${supabaseUrl}/functions/v1/synopsis-scraping-coordinator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId,
        config: {
          // Optional: Override default config based on job characteristics
          adaptiveRateLimiting: true
        }
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Scraping coordinator failed: ${error}`)
    }

    const result = await response.json()
    console.log(`Scraping coordinator result:`, result)
    
  } catch (error) {
    console.error('Error triggering scraping coordinator:', error)
    throw error
  }
}