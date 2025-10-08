// Scraping Coordinator - Manages parallel page scraping with concurrency control
// Implements worker pool pattern with rate limiting and priority queue

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CircuitBreaker, createCircuitBreaker } from "./circuit-breaker.ts";
import { retryWithStrategy, RetryOptions } from "./retry-strategies.ts";
import { ScrapingFallbackChain } from "./scraping-fallbacks.ts";

export interface ScrapingConfig {
  maxConcurrency: number;        // Maximum parallel scrapers
  batchSize: number;             // Pages per batch
  delayBetweenRequests: number;  // Minimum delay between requests (ms)
  maxRetries: number;            // Maximum retries per page
  timeout: number;               // Timeout per scrape (ms)
  adaptiveRateLimiting: boolean; // Enable dynamic rate adjustment
}

export interface PageTask {
  id: string;
  job_id: string;
  url: string;
  priority: number;
  is_critical: boolean;
  fallback_urls?: string[];
  retry_count: number;
}

export interface WorkerStatus {
  id: number;
  status: 'idle' | 'scraping' | 'failed';
  currentTask?: PageTask;
  tasksCompleted: number;
  tasksFailed: number;
  lastActivity: Date;
}

export class ScrapingCoordinator {
  private config: ScrapingConfig;
  private workers: Map<number, WorkerStatus> = new Map();
  private taskQueue: PageTask[] = [];
  private activeRequests = 0;
  private lastRequestTime = 0;
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;
  private circuitBreaker: CircuitBreaker;
  private scrapingChain: ScrapingFallbackChain;
  
  // Performance metrics
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    queueDepth: 0
  };

  constructor(
    private supabase: SupabaseClient,
    config?: Partial<ScrapingConfig>
  ) {
    this.config = {
      maxConcurrency: 5,
      batchSize: 10,
      delayBetweenRequests: 1000,
      maxRetries: 3,
      timeout: 30000,
      adaptiveRateLimiting: true,
      ...config
    };
    
    this.circuitBreaker = createCircuitBreaker('scraperapi', supabase);
    this.scrapingChain = new ScrapingFallbackChain(supabase);
    
    // Initialize workers
    for (let i = 0; i < this.config.maxConcurrency; i++) {
      this.workers.set(i, {
        id: i,
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
        lastActivity: new Date()
      });
    }
  }

  /**
   * Process all pages for a job with controlled concurrency
   */
  async processJob(jobId: string): Promise<void> {
    console.log(`Starting parallel scraping for job ${jobId}`);
    
    try {
      // Load tasks from database ordered by priority
      await this.loadTaskQueue(jobId);
      
      if (this.taskQueue.length === 0) {
        console.log('No tasks to process');
        return;
      }
      
      console.log(`Loaded ${this.taskQueue.length} tasks for processing`);
      
      // Start worker coordination
      const workerPromises: Promise<void>[] = [];
      
      // Launch workers up to max concurrency
      for (let i = 0; i < Math.min(this.config.maxConcurrency, this.taskQueue.length); i++) {
        workerPromises.push(this.runWorker(i));
      }
      
      // Wait for all workers to complete
      await Promise.all(workerPromises);
      
      console.log(`Completed processing job ${jobId}`);
      console.log(`Metrics:`, this.metrics);
      
    } catch (error) {
      console.error(`Error processing job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Load tasks from database with priority ordering
   */
  private async loadTaskQueue(jobId: string): Promise<void> {
    const { data: tasks, error } = await this.supabase
      .from('synopsis_page_tasks')
      .select('*')
      .eq('job_id', jobId)
      .in('status', ['pending', 'processing']) // Include processing in case of restart
      .order('is_critical', { ascending: false })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to load tasks: ${error.message}`);
    }

    this.taskQueue = tasks || [];
    this.metrics.queueDepth = this.taskQueue.length;
  }

  /**
   * Run a worker that processes tasks from the queue
   */
  private async runWorker(workerId: number): Promise<void> {
    const worker = this.workers.get(workerId)!;
    
    while (this.taskQueue.length > 0) {
      // Get next task from queue
      const task = this.taskQueue.shift();
      if (!task) break;
      
      // Update worker status
      worker.status = 'scraping';
      worker.currentTask = task;
      worker.lastActivity = new Date();
      
      try {
        // Apply rate limiting
        await this.applyRateLimit();
        
        // Process the task
        await this.processTask(task, workerId);
        
        // Update success metrics
        worker.tasksCompleted++;
        this.consecutiveSuccesses++;
        this.consecutiveFailures = 0;
        
        // Adapt rate limit based on success
        if (this.config.adaptiveRateLimiting) {
          this.adaptRateLimit(true);
        }
        
      } catch (error) {
        console.error(`Worker ${workerId} failed task ${task.id}:`, error);
        
        // Update failure metrics
        worker.tasksFailed++;
        this.consecutiveFailures++;
        this.consecutiveSuccesses = 0;
        
        // Put task back in queue if retries remain
        if (task.retry_count < this.config.maxRetries) {
          task.retry_count++;
          this.taskQueue.push(task); // Add to end of queue
        }
        
        // Adapt rate limit based on failure
        if (this.config.adaptiveRateLimiting) {
          this.adaptRateLimit(false);
        }
      }
      
      // Update worker status
      worker.status = 'idle';
      worker.currentTask = undefined;
    }
    
    console.log(`Worker ${workerId} completed. Tasks: ${worker.tasksCompleted}, Failed: ${worker.tasksFailed}`);
  }

  /**
   * Process a single page task
   */
  private async processTask(task: PageTask, workerId: number): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Update task status to processing
      await this.supabase
        .from('synopsis_page_tasks')
        .update({ 
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', task.id);

      console.log(`Worker ${workerId} scraping: ${task.url}`);
      
      // Scrape the page with circuit breaker and retry logic
      const result = await retryWithStrategy(
        async () => {
          // Check if API is available
          const isAvailable = await this.circuitBreaker.isAvailable();
          if (!isAvailable) {
            throw new Error('API circuit breaker is open');
          }
          
          // Scrape with fallback chain
          return await this.scrapingChain.scrape(task.url, {
            timeout: this.config.timeout
          });
        },
        {
          maxRetries: 2,
          strategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 10000,
          jitter: true,
          shouldRetry: (error) => {
            // Don't retry circuit breaker errors
            return !error.message.includes('circuit breaker');
          }
        }
      );

      // Convert HTML to markdown
      const markdown = await this.convertToMarkdown(result.html);
      
      // Update task with results
      await this.supabase
        .from('synopsis_page_tasks')
        .update({
          status: 'completed',
          raw_html: result.html.substring(0, 1000000), // Limit size
          markdown_content: markdown,
          scraping_method: result.method,
          completed_at: new Date().toISOString(),
          error_message: null
        })
        .eq('id', task.id);

      // Update metrics
      this.metrics.successfulRequests++;
      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);
      
      // Record API usage
      await this.supabase.rpc('record_api_usage', {
        p_api_name: result.method,
        p_success: true,
        p_response_time_ms: responseTime
      });

      console.log(`Worker ${workerId} completed ${task.url} in ${responseTime}ms`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Handle failures
      await this.handleTaskFailure(task, errorMessage);
      
      // Update metrics
      this.metrics.failedRequests++;
      
      // Record API failure
      await this.supabase.rpc('record_api_usage', {
        p_api_name: 'scraperapi',
        p_success: false
      });
      
      throw error;
    } finally {
      this.metrics.totalRequests++;
      this.activeRequests--;
    }
  }

  /**
   * Handle task failure with smart retry logic
   */
  private async handleTaskFailure(task: PageTask, errorMessage: string): Promise<void> {
    const isFinalRetry = task.retry_count >= this.config.maxRetries;
    
    if (isFinalRetry && task.fallback_urls && task.fallback_urls.length > 0) {
      // Try fallback URLs
      console.log(`Trying fallback URLs for task ${task.id}`);
      
      for (const fallbackUrl of task.fallback_urls) {
        try {
          const fallbackTask = { ...task, url: fallbackUrl };
          await this.processTask(fallbackTask, -1); // Process inline
          return; // Success with fallback
        } catch (fallbackError) {
          console.error(`Fallback URL failed: ${fallbackUrl}`);
        }
      }
    }
    
    // Mark as failed if no more retries or all fallbacks failed
    if (isFinalRetry) {
      await this.supabase
        .from('synopsis_page_tasks')
        .update({
          status: 'failed',
          error_message: `Failed after ${task.retry_count} retries: ${errorMessage}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', task.id);
    } else {
      // Mark as pending for retry
      await this.supabase
        .from('synopsis_page_tasks')
        .update({
          status: 'pending',
          retry_count: task.retry_count,
          last_retry_at: new Date().toISOString(),
          error_message: `Retry ${task.retry_count}: ${errorMessage}`
        })
        .eq('id', task.id);
    }
  }

  /**
   * Apply rate limiting between requests
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = this.config.delayBetweenRequests;
    
    if (timeSinceLastRequest < minDelay) {
      const waitTime = minDelay - timeSinceLastRequest;
      await this.sleep(waitTime);
    }
    
    this.lastRequestTime = Date.now();
    this.activeRequests++;
  }

  /**
   * Adapt rate limit based on success/failure patterns
   */
  private adaptRateLimit(success: boolean): void {
    if (!this.config.adaptiveRateLimiting) return;
    
    if (success) {
      // Speed up after consecutive successes
      if (this.consecutiveSuccesses > 5) {
        this.config.delayBetweenRequests = Math.max(
          500, // Minimum 500ms
          this.config.delayBetweenRequests * 0.9
        );
        console.log(`Decreased delay to ${this.config.delayBetweenRequests}ms`);
      }
    } else {
      // Slow down after failures
      if (this.consecutiveFailures > 2) {
        this.config.delayBetweenRequests = Math.min(
          5000, // Maximum 5s
          this.config.delayBetweenRequests * 1.5
        );
        console.log(`Increased delay to ${this.config.delayBetweenRequests}ms`);
      }
    }
  }

  /**
   * Convert HTML to markdown
   */
  private async convertToMarkdown(html: string): Promise<string> {
    // Basic conversion - enhance as needed
    let markdown = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<h1[^>]*>/gi, '# ')
      .replace(/<h2[^>]*>/gi, '## ')
      .replace(/<h3[^>]*>/gi, '### ')
      .replace(/<h4[^>]*>/gi, '#### ')
      .replace(/<h5[^>]*>/gi, '##### ')
      .replace(/<h6[^>]*>/gi, '###### ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim();
      
    return markdown;
  }

  /**
   * Update average response time metric
   */
  private updateAverageResponseTime(responseTime: number): void {
    const total = this.metrics.averageResponseTime * (this.metrics.successfulRequests - 1);
    this.metrics.averageResponseTime = (total + responseTime) / this.metrics.successfulRequests;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current coordinator status
   */
  getStatus(): {
    workers: WorkerStatus[];
    metrics: typeof this.metrics;
    config: ScrapingConfig;
    queueLength: number;
  } {
    return {
      workers: Array.from(this.workers.values()),
      metrics: this.metrics,
      config: this.config,
      queueLength: this.taskQueue.length
    };
  }

  /**
   * Gracefully stop all workers
   */
  async stop(): Promise<void> {
    console.log('Stopping scraping coordinator...');
    // Workers will naturally stop when queue is empty
    this.taskQueue = [];
  }
}