// Supabase Edge Function: shopify-admin-ui
// Description: Admin UI for managing Shopify integration

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Define the HTML template
const ADMIN_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shopify Integration Admin</title>
  <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.12.0/dist/cdn.min.js" defer></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    [x-cloak] { display: none !important; }
    .loading-spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #3498db;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      animation: spin 1s linear infinite;
      display: inline-block;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div x-data="adminApp()" x-init="initialize()" x-cloak class="container mx-auto px-4 py-8">
    <header class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800">Shopify Integration Admin</h1>
      <p class="text-gray-600 mt-2">Manage Shopify blog synchronization for clients</p>
    </header>

    <!-- Alerts -->
    <div x-show="alert.show" :class="'p-4 mb-6 rounded-md ' + alert.class" class="mb-6">
      <div class="flex">
        <div>
          <p x-text="alert.message" class="text-sm"></p>
        </div>
        <button @click="alert.show = false" class="ml-auto">
          <span class="text-sm">&times;</span>
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 mb-6">
      <nav class="-mb-px flex space-x-8">
        <button @click="activeTab = 'clients'" 
          :class="activeTab === 'clients' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
          Client Configurations
        </button>
        <button @click="activeTab = 'content'" 
          :class="activeTab === 'content' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
          Content Management
        </button>
        <button @click="activeTab = 'queue'; loadQueue()" 
          :class="activeTab === 'queue' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm">
          Queue Status
        </button>
      </nav>
    </div>

    <!-- Client Configurations Tab -->
    <div x-show="activeTab === 'clients'">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold text-gray-800">Client Shopify Configurations</h2>
        <button @click="openConfigModal(null)" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          Add Configuration
        </button>
      </div>
      
      <!-- Loading State -->
      <div x-show="isLoading" class="text-center my-8">
        <div class="loading-spinner mx-auto"></div>
        <p class="mt-2 text-gray-600">Loading configurations...</p>
      </div>
      
      <!-- Content -->
      <div x-show="!isLoading">
        <!-- Client Selection -->
        <div class="mb-6">
          <label for="clientSelect" class="block text-sm font-medium text-gray-700 mb-1">Filter by Client:</label>
          <select id="clientSelect" x-model="selectedClientId" @change="loadShopifyConfigs()" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
            <option value="">All Clients</option>
            <template x-for="client in clients" :key="client.id">
              <option :value="client.id" x-text="client.name"></option>
            </template>
          </select>
        </div>
        
        <!-- Empty State -->
        <div x-show="shopifyConfigs.length === 0" class="text-center my-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
          <p class="text-gray-600">No Shopify configurations found.</p>
          <button @click="openConfigModal(null)" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Add Configuration
          </button>
        </div>
        
        <!-- Configuration Table -->
        <div x-show="shopifyConfigs.length > 0" class="overflow-x-auto">
          <table class="min-w-full bg-white border border-gray-200 rounded-md">
            <thead class="bg-gray-50">
              <tr>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shopify Domain</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Blog</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <template x-for="config in shopifyConfigs" :key="config.id">
                <tr class="hover:bg-gray-50">
                  <td class="py-3 px-4 text-sm" x-text="getClientName(config.client_id)"></td>
                  <td class="py-3 px-4 text-sm" x-text="config.shopify_domain"></td>
                  <td class="py-3 px-4 text-sm" x-text="config.shopify_blog_id"></td>
                  <td class="py-3 px-4 text-sm" x-text="formatDate(config.updated_at)"></td>
                  <td class="py-3 px-4 text-right">
                    <button @click="openConfigModal(config)" class="text-blue-600 hover:text-blue-800 mr-2">
                      Edit
                    </button>
                    <button @click="confirmDeleteConfig(config)" class="text-red-600 hover:text-red-800">
                      Delete
                    </button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Content Management Tab -->
    <div x-show="activeTab === 'content'">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold text-gray-800">Content Synchronization Status</h2>
        <div>
          <button @click="loadContentStatus()" class="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 mr-2">
            Refresh
          </button>
          <button @click="openBulkOperationsModal()" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Bulk Operations
          </button>
        </div>
      </div>
      
      <!-- Loading State -->
      <div x-show="isLoading" class="text-center my-8">
        <div class="loading-spinner mx-auto"></div>
        <p class="mt-2 text-gray-600">Loading content status...</p>
      </div>
      
      <!-- Content Selection Form -->
      <div x-show="!isLoading" class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label for="contentClientSelect" class="block text-sm font-medium text-gray-700 mb-1">Client:</label>
          <select id="contentClientSelect" x-model="selectedContentClientId" @change="loadContentStatus()" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
            <option value="">Select Client</option>
            <template x-for="client in clients" :key="client.id">
              <option :value="client.id" x-text="client.name"></option>
            </template>
          </select>
        </div>
        <div>
          <label for="statusFilter" class="block text-sm font-medium text-gray-700 mb-1">Status Filter:</label>
          <select id="statusFilter" x-model="statusFilter" @change="filterContent()" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
            <option value="">All Content</option>
            <option value="synced">Synced Only</option>
            <option value="not_synced">Not Synced Only</option>
            <option value="published">Published Only</option>
            <option value="draft">Draft Only</option>
          </select>
        </div>
      </div>
      
      <!-- Empty State -->
      <div x-show="!isLoading && (!contentItems || contentItems.length === 0)" class="text-center my-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
        <p class="text-gray-600">No content items found.</p>
        <p class="text-gray-500 mt-2">Select a client to view content status.</p>
      </div>
      
      <!-- Content Table -->
      <div x-show="!isLoading && contentItems && contentItems.length > 0" class="overflow-x-auto">
        <table class="min-w-full bg-white border border-gray-200 rounded-md">
          <thead class="bg-gray-50">
            <tr>
              <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shopify Status</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Synced</th>
              <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <template x-for="item in filteredContentItems" :key="item.guid">
              <tr class="hover:bg-gray-50">
                <td class="py-3 px-4 text-sm">
                  <p class="font-medium" x-text="item.title"></p>
                  <p x-show="item.shopify_sync.post_url" class="text-xs text-gray-500 mt-1">
                    <a :href="item.shopify_sync.post_url" target="_blank" class="text-blue-600 hover:underline" x-text="item.shopify_sync.post_url"></a>
                  </p>
                </td>
                <td class="py-3 px-4 text-sm">
                  <span x-show="item.status === 'completed'" class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Completed</span>
                  <span x-show="item.status !== 'completed'" x-text="item.status" class="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800"></span>
                </td>
                <td class="py-3 px-4 text-sm">
                  <div x-show="item.shopify_sync.is_synced">
                    <span x-show="item.shopify_sync.is_published" class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Published</span>
                    <span x-show="!item.shopify_sync.is_published" class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Draft</span>
                    <p x-show="item.shopify_sync.sync_error" class="text-red-600 text-xs mt-1" x-text="item.shopify_sync.sync_error"></p>
                  </div>
                  <span x-show="!item.shopify_sync.is_synced" class="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">Not Synced</span>
                </td>
                <td class="py-3 px-4 text-sm" x-text="item.shopify_sync.last_synced_at ? formatDate(item.shopify_sync.last_synced_at) : 'Never'"></td>
                <td class="py-3 px-4 text-right">
                  <div class="flex flex-col space-y-1">
                    <button 
                      @click="performOperation('sync', item.guid, item.client_id)" 
                      class="text-blue-600 hover:text-blue-800 text-sm"
                      :disabled="item.status !== 'completed' || operationInProgress"
                      :class="{ 'opacity-50 cursor-not-allowed': item.status !== 'completed' || operationInProgress }">
                      Sync to Shopify
                    </button>
                    <button 
                      x-show="item.shopify_sync.is_synced"
                      @click="performOperation('update', item.guid, item.client_id)" 
                      class="text-blue-600 hover:text-blue-800 text-sm"
                      :disabled="operationInProgress"
                      :class="{ 'opacity-50 cursor-not-allowed': operationInProgress }">
                      Update
                    </button>
                    <button 
                      x-show="item.shopify_sync.is_synced && !item.shopify_sync.is_published"
                      @click="performOperation('publish', item.guid, item.client_id)" 
                      class="text-green-600 hover:text-green-800 text-sm"
                      :disabled="operationInProgress"
                      :class="{ 'opacity-50 cursor-not-allowed': operationInProgress }">
                      Publish
                    </button>
                    <button 
                      x-show="item.shopify_sync.is_synced && item.shopify_sync.is_published"
                      @click="performOperation('unpublish', item.guid, item.client_id)" 
                      class="text-yellow-600 hover:text-yellow-800 text-sm"
                      :disabled="operationInProgress"
                      :class="{ 'opacity-50 cursor-not-allowed': operationInProgress }">
                      Unpublish
                    </button>
                    <button 
                      x-show="item.shopify_sync.is_synced"
                      @click="confirmDeleteArticle(item)" 
                      class="text-red-600 hover:text-red-800 text-sm"
                      :disabled="operationInProgress"
                      :class="{ 'opacity-50 cursor-not-allowed': operationInProgress }">
                      Delete from Shopify
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Queue Status Tab -->
    <div x-show="activeTab === 'queue'">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-semibold text-gray-800">Queue Status</h2>
        <div>
          <button @click="loadQueue()" class="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 mr-2">
            Refresh
          </button>
          <button @click="processQueue()" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700" :disabled="isProcessingQueue" :class="{ 'opacity-50 cursor-not-allowed': isProcessingQueue }">
            <span x-show="!isProcessingQueue">Process Queue Now</span>
            <span x-show="isProcessingQueue" class="flex items-center">
              <span class="loading-spinner mr-2"></span>
              Processing...
            </span>
          </button>
        </div>
      </div>
      
      <!-- Loading State -->
      <div x-show="isLoading" class="text-center my-8">
        <div class="loading-spinner mx-auto"></div>
        <p class="mt-2 text-gray-600">Loading queue items...</p>
      </div>
      
      <!-- Content -->
      <div x-show="!isLoading">
        <div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="queueClientSelect" class="block text-sm font-medium text-gray-700 mb-1">Client:</label>
            <select id="queueClientSelect" x-model="selectedQueueClientId" @change="loadQueue()" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
              <option value="">All Clients</option>
              <template x-for="client in clients" :key="client.id">
                <option :value="client.id" x-text="client.name"></option>
              </template>
            </select>
          </div>
          <div>
            <label for="queueStatusFilter" class="block text-sm font-medium text-gray-700 mb-1">Status:</label>
            <select id="queueStatusFilter" x-model="queueStatusFilter" @change="loadQueue()" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
              <option value="pending">Pending Only</option>
              <option value="processed">Processed Only</option>
              <option value="error">Errors Only</option>
              <option value="all">All Queue Items</option>
            </select>
          </div>
        </div>
        
        <!-- Summary Stats -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <h3 class="text-sm font-medium text-gray-500">Pending Items</h3>
            <p class="text-2xl font-bold text-gray-900 mt-1" x-text="queueStats.pending || 0"></p>
          </div>
          <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <h3 class="text-sm font-medium text-gray-500">Processed Today</h3>
            <p class="text-2xl font-bold text-gray-900 mt-1" x-text="queueStats.processedToday || 0"></p>
          </div>
          <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <h3 class="text-sm font-medium text-gray-500">Errors</h3>
            <p class="text-2xl font-bold text-red-600 mt-1" x-text="queueStats.errors || 0"></p>
          </div>
        </div>
        
        <!-- Empty State -->
        <div x-show="queueItems.length === 0" class="text-center my-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
          <p class="text-gray-600">No queue items found.</p>
        </div>
        
        <!-- Queue Table -->
        <div x-show="queueItems.length > 0" class="overflow-x-auto">
          <table class="min-w-full bg-white border border-gray-200 rounded-md">
            <thead class="bg-gray-50">
              <tr>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Content Title</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operation</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                <th class="py-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th class="py-3 px-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <template x-for="item in queueItems" :key="item.id">
                <tr class="hover:bg-gray-50">
                  <td class="py-3 px-4 text-sm" x-text="item.content_title || 'Unknown'"></td>
                  <td class="py-3 px-4 text-sm" x-text="getClientName(item.client_id)"></td>
                  <td class="py-3 px-4 text-sm">
                    <span x-text="item.operation" class="capitalize"></span>
                    <span x-show="item.operation === 'publish'" x-text="item.publish_status ? 'true' : 'false'" class="text-xs text-gray-500 ml-1"></span>
                  </td>
                  <td class="py-3 px-4 text-sm" x-text="formatDate(item.created_at)"></td>
                  <td class="py-3 px-4 text-sm">
                    <span x-show="!item.processed_at && !item.error_message" class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>
                    <span x-show="item.processed_at && !item.error_message" class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Processed</span>
                    <span x-show="item.error_message" class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Error</span>
                    <p x-show="item.error_message" class="text-red-600 text-xs mt-1" x-text="item.error_message"></p>
                  </td>
                  <td class="py-3 px-4 text-right">
                    <div class="flex flex-col space-y-1">
                      <button 
                        x-show="!item.processed_at"
                        @click="deleteQueueItem(item.id)" 
                        class="text-red-600 hover:text-red-800 text-sm">
                        Cancel
                      </button>
                      <button 
                        x-show="item.error_message"
                        @click="retryQueueItem(item.id)" 
                        class="text-blue-600 hover:text-blue-800 text-sm">
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Config Modal -->
    <div x-show="showConfigModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div @click.away="showConfigModal = false" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 class="text-lg font-medium text-gray-900 mb-4" x-text="editingConfig ? 'Edit Shopify Configuration' : 'Add Shopify Configuration'"></h3>
        
        <form @submit.prevent="saveShopifyConfig">
          <!-- Client Selection -->
          <div class="mb-4">
            <label for="configClient" class="block text-sm font-medium text-gray-700 mb-1">Client:</label>
            <select id="configClient" x-model="configForm.client_id" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
              <option value="">Select Client</option>
              <template x-for="client in clients" :key="client.id">
                <option :value="client.id" x-text="client.name"></option>
              </template>
            </select>
          </div>
          
          <!-- Basic Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label for="shopifyDomain" class="block text-sm font-medium text-gray-700 mb-1">Shopify Domain:</label>
              <input type="text" id="shopifyDomain" x-model="configForm.shopify_domain" placeholder="mystore.myshopify.com" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
            <div>
              <label for="shopifyApiVersion" class="block text-sm font-medium text-gray-700 mb-1">API Version:</label>
              <input type="text" id="shopifyApiVersion" x-model="configForm.shopify_api_version" placeholder="2023-10" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
          </div>
          
          <!-- Access Token -->
          <div class="mb-4">
            <label for="shopifyAccessToken" class="block text-sm font-medium text-gray-700 mb-1">Shopify Access Token:</label>
            <input type="password" id="shopifyAccessToken" x-model="configForm.shopify_access_token" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            <p class="text-xs text-gray-500 mt-1">Requires access to Blog content</p>
          </div>
          
          <!-- Blog Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label for="shopifyBlogId" class="block text-sm font-medium text-gray-700 mb-1">Blog ID:</label>
              <input type="text" id="shopifyBlogId" x-model="configForm.shopify_blog_id" placeholder="123456789" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
            <div>
              <label for="shopifyBlogUrl" class="block text-sm font-medium text-gray-700 mb-1">Blog URL:</label>
              <input type="text" id="shopifyBlogUrl" x-model="configForm.shopify_blog_url" placeholder="https://mystore.com/blogs/news" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
          </div>
          
          <!-- Optional Settings -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label for="shopifyPostSuffix" class="block text-sm font-medium text-gray-700 mb-1">Post Title Suffix:</label>
              <input type="text" id="shopifyPostSuffix" x-model="configForm.shopify_post_suffix" placeholder="(optional)" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
            <div>
              <label for="shopifyPostAuthor" class="block text-sm font-medium text-gray-700 mb-1">Default Author:</label>
              <input type="text" id="shopifyPostAuthor" x-model="configForm.shopify_post_author" placeholder="(optional)" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            </div>
          </div>
          
          <div class="mb-4">
            <label for="shopifyPostFeaturedImage" class="block text-sm font-medium text-gray-700 mb-1">Default Featured Image URL:</label>
            <input type="text" id="shopifyPostFeaturedImage" x-model="configForm.shopify_post_featured_image" placeholder="https://example.com/default-image.jpg (optional)" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
          </div>
          
          <div class="mb-4">
            <label for="shopifyLiveUrl" class="block text-sm font-medium text-gray-700 mb-1">Store URL:</label>
            <input type="text" id="shopifyLiveUrl" x-model="configForm.shopify_live_url" placeholder="https://mystore.com" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
          </div>
          
          <!-- Optional Webhook Secret -->
          <div class="mb-4">
            <label for="shopifyWebhookSecret" class="block text-sm font-medium text-gray-700 mb-1">Webhook Secret:</label>
            <input type="password" id="shopifyWebhookSecret" x-model="configForm.shopify_webhook_secret" placeholder="(optional for webhook verification)" class="block w-full p-2 border border-gray-300 rounded-md shadow-sm" />
            <p class="text-xs text-gray-500 mt-1">For verifying incoming Shopify webhooks</p>
          </div>
          
          <!-- Actions -->
          <div class="flex justify-end pt-4 border-t border-gray-200">
            <button type="button" @click="showConfigModal = false" class="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 mr-2">
              Cancel
            </button>
            <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div x-show="showDeleteModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div @click.away="showDeleteModal = false" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 class="text-lg font-medium text-gray-900 mb-4" x-text="deleteModalData.title"></h3>
        <p class="text-gray-700 mb-6" x-text="deleteModalData.message"></p>
        
        <div class="flex justify-end">
          <button type="button" @click="showDeleteModal = false" class="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 mr-2">
            Cancel
          </button>
          <button type="button" @click="deleteModalData.onConfirm()" class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
    
    <!-- Bulk Operations Modal -->
    <div x-show="showBulkModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div @click.away="showBulkModal = false" class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 class="text-lg font-medium text-gray-900 mb-4">Bulk Operations</h3>
        
        <form @submit.prevent="performBulkOperation()">
          <div class="mb-4">
            <label for="bulkClient" class="block text-sm font-medium text-gray-700 mb-1">Client:</label>
            <select id="bulkClient" x-model="bulkForm.client_id" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
              <option value="">Select Client</option>
              <template x-for="client in clients" :key="client.id">
                <option :value="client.id" x-text="client.name"></option>
              </template>
            </select>
          </div>
          
          <div class="mb-4">
            <label for="bulkOperation" class="block text-sm font-medium text-gray-700 mb-1">Operation:</label>
            <select id="bulkOperation" x-model="bulkForm.operation" required class="block w-full p-2 border border-gray-300 rounded-md shadow-sm">
              <option value="">Select Operation</option>
              <option value="sync">Sync All Completed Outlines</option>
              <option value="update">Update All Synced Articles</option>
              <option value="publish">Publish All Synced Articles</option>
              <option value="unpublish">Unpublish All Articles</option>
            </select>
          </div>
          
          <div class="mb-4">
            <div class="flex items-center">
              <input type="checkbox" id="bulkConfirm" x-model="bulkForm.confirmed" required class="h-4 w-4 text-blue-600" />
              <label for="bulkConfirm" class="ml-2 block text-sm text-gray-700">
                I confirm this will affect multiple items
              </label>
            </div>
          </div>
          
          <div class="flex justify-end pt-4 border-t border-gray-200">
            <button type="button" @click="showBulkModal = false" class="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 mr-2">
              Cancel
            </button>
            <button 
              type="submit" 
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              :disabled="!bulkForm.client_id || !bulkForm.operation || !bulkForm.confirmed"
              :class="{ 'opacity-50 cursor-not-allowed': !bulkForm.client_id || !bulkForm.operation || !bulkForm.confirmed }">
              Start Bulk Operation
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <script>
    function adminApp() {
      return {
        // API endpoints
        apiUrl: "",
        anonKey: "",
        
        // State management
        activeTab: 'clients',
        isLoading: false,
        isProcessingQueue: false,
        operationInProgress: false,
        
        // Modal states
        showConfigModal: false,
        showDeleteModal: false,
        showBulkModal: false,
        
        // Delete modal data
        deleteModalData: {
          title: '',
          message: '',
          onConfirm: () => {}
        },
        
        // Alert data
        alert: {
          show: false,
          message: '',
          class: 'bg-green-100 text-green-800'
        },
        
        // Data stores
        clients: [],
        shopifyConfigs: [],
        contentItems: [],
        filteredContentItems: [],
        queueItems: [],
        
        // Form data
        configForm: {
          id: null,
          client_id: '',
          shopify_domain: '',
          shopify_api_version: '2023-10',
          shopify_access_token: '',
          shopify_blog_id: '',
          shopify_blog_url: '',
          shopify_post_suffix: '',
          shopify_post_author: '',
          shopify_post_featured_image: '',
          shopify_live_url: '',
          shopify_webhook_secret: ''
        },
        
        bulkForm: {
          client_id: '',
          operation: '',
          confirmed: false
        },
        
        // Filter states
        selectedClientId: '',
        selectedContentClientId: '',
        selectedQueueClientId: '',
        statusFilter: '',
        queueStatusFilter: 'pending',
        
        // Queue stats
        queueStats: {
          pending: 0,
          processedToday: 0,
          errors: 0
        },
        
        // Initialization
        async initialize() {
          // Set API credentials
          this.apiUrl = SUPABASE_URL
          this.anonKey = SUPABASE_ANON_KEY
          
          // Load initial data
          await this.loadClients()
          await this.loadShopifyConfigs()
        },
        
        // Show error alert
        showError(message) {
          this.alert = {
            show: true,
            message: message,
            class: 'bg-red-100 text-red-800'
          }
        },
        
        // Show success alert
        showSuccess(message) {
          this.alert = {
            show: true,
            message: message,
            class: 'bg-green-100 text-green-800'
          }
        },
        
        // Format date for display
        formatDate(dateString) {
          if (!dateString) return '-'
          const date = new Date(dateString)
          return date.toLocaleString()
        },
        
        // Get client name by ID
        getClientName(clientId) {
          const client = this.clients.find(c => c.id === clientId)
          return client ? client.name : 'Unknown Client'
        },
        
        // Clear config form
        resetConfigForm() {
          this.configForm = {
            id: null,
            client_id: '',
            shopify_domain: '',
            shopify_api_version: '2023-10',
            shopify_access_token: '',
            shopify_blog_id: '',
            shopify_blog_url: '',
            shopify_post_suffix: '',
            shopify_post_author: '',
            shopify_post_featured_image: '',
            shopify_live_url: '',
            shopify_webhook_secret: ''
          }
        },
        
        // Load clients
        async loadClients() {
          try {
            this.isLoading = true
            const response = await fetch(\`\${this.apiUrl}/rest/v1/clients?select=id,name&order=name.asc\`, {
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey
              }
            })
            
            if (!response.ok) {
              throw new Error('Failed to load clients')
            }
            
            this.clients = await response.json()
          } catch (error) {
            console.error('Error loading clients:', error)
            this.showError('Failed to load clients: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Load Shopify configurations
        async loadShopifyConfigs() {
          try {
            this.isLoading = true
            
            let url = \`\${this.apiUrl}/rest/v1/shopify_configs?select=*&order=updated_at.desc\`
            if (this.selectedClientId) {
              url += \`&client_id=eq.\${this.selectedClientId}\`
            }
            
            const response = await fetch(url, {
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey
              }
            })
            
            if (!response.ok) {
              throw new Error('Failed to load Shopify configurations')
            }
            
            this.shopifyConfigs = await response.json()
          } catch (error) {
            console.error('Error loading Shopify configs:', error)
            this.showError('Failed to load Shopify configurations: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Open config modal for editing
        openConfigModal(config) {
          this.resetConfigForm()
          this.editingConfig = !!config
          
          if (config) {
            this.configForm = { ...config }
          }
          
          this.showConfigModal = true
        },
        
        // Save Shopify configuration
        async saveShopifyConfig() {
          try {
            this.isLoading = true
            
            const isUpdate = !!this.configForm.id
            const method = isUpdate ? 'PATCH' : 'POST'
            const url = isUpdate 
              ? \`\${this.apiUrl}/rest/v1/shopify_configs?id=eq.\${this.configForm.id}\`
              : \`\${this.apiUrl}/rest/v1/shopify_configs\`
            
            const response = await fetch(url, {
              method: method,
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey,
                'Content-Type': 'application/json',
                'Prefer': isUpdate ? 'return=representation' : 'return=representation'
              },
              body: JSON.stringify(this.configForm)
            })
            
            if (!response.ok) {
              throw new Error('Failed to save configuration')
            }
            
            this.showSuccess(\`Shopify configuration \${isUpdate ? 'updated' : 'created'} successfully\`)
            this.showConfigModal = false
            await this.loadShopifyConfigs()
          } catch (error) {
            console.error('Error saving config:', error)
            this.showError('Failed to save configuration: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Confirm delete config
        confirmDeleteConfig(config) {
          this.deleteModalData = {
            title: 'Delete Shopify Configuration',
            message: \`Are you sure you want to delete the Shopify configuration for \${this.getClientName(config.client_id)}? This action cannot be undone.\`,
            onConfirm: () => this.deleteShopifyConfig(config.id)
          }
          this.showDeleteModal = true
        },
        
        // Delete Shopify configuration
        async deleteShopifyConfig(configId) {
          try {
            this.isLoading = true
            this.showDeleteModal = false
            
            const response = await fetch(\`\${this.apiUrl}/rest/v1/shopify_configs?id=eq.\${configId}\`, {
              method: 'DELETE',
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey
              }
            })
            
            if (!response.ok) {
              throw new Error('Failed to delete configuration')
            }
            
            this.showSuccess('Shopify configuration deleted successfully')
            await this.loadShopifyConfigs()
          } catch (error) {
            console.error('Error deleting config:', error)
            this.showError('Failed to delete configuration: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Load content status
        async loadContentStatus() {
          if (!this.selectedContentClientId) {
            this.contentItems = []
            this.filteredContentItems = []
            return
          }
          
          try {
            this.isLoading = true
            
            const response = await fetch(\`\${window.location.origin}/shopify-status?client_id=\${this.selectedContentClientId}&include_queue=true\`)
            
            if (!response.ok) {
              throw new Error('Failed to load content status')
            }
            
            const data = await response.json()
            this.contentItems = data.records || []
            this.filterContent()
          } catch (error) {
            console.error('Error loading content status:', error)
            this.showError('Failed to load content status: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Filter content based on status
        filterContent() {
          if (!this.contentItems) {
            this.filteredContentItems = []
            return
          }
          
          switch (this.statusFilter) {
            case 'synced':
              this.filteredContentItems = this.contentItems.filter(item => item.shopify_sync.is_synced)
              break
            case 'not_synced':
              this.filteredContentItems = this.contentItems.filter(item => !item.shopify_sync.is_synced)
              break
            case 'published':
              this.filteredContentItems = this.contentItems.filter(item => item.shopify_sync.is_synced && item.shopify_sync.is_published)
              break
            case 'draft':
              this.filteredContentItems = this.contentItems.filter(item => item.shopify_sync.is_synced && !item.shopify_sync.is_published)
              break
            default:
              this.filteredContentItems = this.contentItems
          }
        },
        
        // Perform Shopify operation on an outline
        async performOperation(operation, outlineGuid, clientId) {
          try {
            this.operationInProgress = true
            
            const response = await fetch(\`\${window.location.origin}/shopify-operations\`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                operation: operation,
                content_plan_outline_guid: outlineGuid,
                client_id: clientId
              })
            })
            
            const data = await response.json()
            
            if (!response.ok) {
              throw new Error(data.error || 'Operation failed')
            }
            
            this.showSuccess(\`Operation '\${operation}' queued successfully\`)
            
            // Refresh queue and content status after a short delay
            setTimeout(async () => {
              if (this.activeTab === 'queue') await this.loadQueue()
              if (this.activeTab === 'content') await this.loadContentStatus()
            }, 1000)
          } catch (error) {
            console.error(\`Error performing \${operation}:\`, error)
            this.showError(\`Failed to perform \${operation}: \${error.message}\`)
          } finally {
            this.operationInProgress = false
          }
        },
        
        // Confirm delete article
        confirmDeleteArticle(item) {
          this.deleteModalData = {
            title: 'Delete Article from Shopify',
            message: \`Are you sure you want to delete the article "\${item.title}" from Shopify? This action cannot be undone.\`,
            onConfirm: () => this.performOperation('delete', item.guid, item.client_id)
          }
          this.showDeleteModal = true
        },
        
        // Open bulk operations modal
        openBulkOperationsModal() {
          this.bulkForm = {
            client_id: this.selectedContentClientId || '',
            operation: '',
            confirmed: false
          }
          this.showBulkModal = true
        },
        
        // Perform bulk operation
        async performBulkOperation() {
          if (!this.bulkForm.client_id || !this.bulkForm.operation || !this.bulkForm.confirmed) {
            return
          }
          
          try {
            this.operationInProgress = true
            this.showBulkModal = false
            
            // Get all outlines for this client
            const response = await fetch(\`\${window.location.origin}/shopify-status?client_id=\${this.bulkForm.client_id}\`)
            
            if (!response.ok) {
              throw new Error('Failed to load content items')
            }
            
            const data = await response.json()
            const items = data.records || []
            let processedCount = 0
            
            // Process each item based on the operation
            for (const item of items) {
              // Skip items that don't meet criteria
              if (this.bulkForm.operation === 'sync' && item.status !== 'completed') continue
              if (['update', 'publish', 'unpublish'].includes(this.bulkForm.operation) && !item.shopify_sync.is_synced) continue
              if (this.bulkForm.operation === 'publish' && item.shopify_sync.is_published) continue
              if (this.bulkForm.operation === 'unpublish' && !item.shopify_sync.is_published) continue
              
              // Queue the operation
              await fetch(\`\${window.location.origin}/shopify-operations\`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  operation: this.bulkForm.operation,
                  content_plan_outline_guid: item.guid,
                  client_id: item.client_id
                })
              })
              
              processedCount++
            }
            
            this.showSuccess(\`Bulk operation queued successfully for \${processedCount} items\`)
            
            // Refresh queue and content status after a short delay
            setTimeout(async () => {
              await this.loadQueue()
              await this.loadContentStatus()
            }, 1000)
          } catch (error) {
            console.error('Error performing bulk operation:', error)
            this.showError('Failed to perform bulk operation: ' + error.message)
          } finally {
            this.operationInProgress = false
          }
        },
        
        // Load queue items
        async loadQueue() {
          try {
            this.isLoading = true
            
            let url = \`\${this.apiUrl}/rest/v1/outline_shopify_queue?select=*,content_plan_outlines(title)&order=created_at.desc\`
            
            // Apply filters
            if (this.selectedQueueClientId) {
              url += \`&client_id=eq.\${this.selectedQueueClientId}\`
            }
            
            if (this.queueStatusFilter === 'pending') {
              url += \`&processed_at=is.null\`
            } else if (this.queueStatusFilter === 'processed') {
              url += \`&processed_at=not.is.null&error_message=is.null\`
            } else if (this.queueStatusFilter === 'error') {
              url += \`&error_message=not.is.null\`
            }
            
            const response = await fetch(url, {
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey
              }
            })
            
            if (!response.ok) {
              throw new Error('Failed to load queue items')
            }
            
            const items = await response.json()
            
            // Format queue items
            this.queueItems = items.map(item => ({
              ...item,
              content_title: item.content_plan_outlines?.title || 'Unknown'
            }))
            
            // Calculate stats
            await this.calculateQueueStats()
          } catch (error) {
            console.error('Error loading queue:', error)
            this.showError('Failed to load queue items: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Calculate queue stats
        async calculateQueueStats() {
          try {
            // Get count of pending items
            const pendingResponse = await fetch(\`\${this.apiUrl}/rest/v1/outline_shopify_queue?processed_at=is.null&select=count\`, {
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey,
                'Prefer': 'count=exact'
              }
            })
            
            // Get count of items processed today
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const todayIso = today.toISOString()
            
            const processedTodayResponse = await fetch(
              \`\${this.apiUrl}/rest/v1/outline_shopify_queue?processed_at=gte.\${todayIso}&select=count\`, {
                headers: {
                  'Authorization': \`Bearer \${this.anonKey}\`,
                  'apikey': this.anonKey,
                  'Prefer': 'count=exact'
                }
              }
            )
            
            // Get count of error items
            const errorsResponse = await fetch(\`\${this.apiUrl}/rest/v1/outline_shopify_queue?error_message=not.is.null&select=count\`, {
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey,
                'Prefer': 'count=exact'
              }
            })
            
            const pendingCount = pendingResponse.headers.get('content-range')?.split('/')[1] || '0'
            const processedTodayCount = processedTodayResponse.headers.get('content-range')?.split('/')[1] || '0'
            const errorsCount = errorsResponse.headers.get('content-range')?.split('/')[1] || '0'
            
            this.queueStats = {
              pending: parseInt(pendingCount),
              processedToday: parseInt(processedTodayCount),
              errors: parseInt(errorsCount)
            }
          } catch (error) {
            console.error('Error calculating queue stats:', error)
          }
        },
        
        // Process queue items manually
        async processQueue() {
          try {
            this.isProcessingQueue = true
            
            const response = await fetch(\`\${window.location.origin}/process-shopify-queue?limit=10\`)
            
            if (!response.ok) {
              throw new Error('Failed to process queue')
            }
            
            const result = await response.json()
            
            this.showSuccess(\`Processed \${result.processed || 0} queue items\`)
            await this.loadQueue()
          } catch (error) {
            console.error('Error processing queue:', error)
            this.showError('Failed to process queue: ' + error.message)
          } finally {
            this.isProcessingQueue = false
          }
        },
        
        // Delete queue item
        async deleteQueueItem(queueItemId) {
          try {
            this.isLoading = true
            
            const response = await fetch(\`\${this.apiUrl}/rest/v1/outline_shopify_queue?id=eq.\${queueItemId}\`, {
              method: 'DELETE',
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey
              }
            })
            
            if (!response.ok) {
              throw new Error('Failed to delete queue item')
            }
            
            this.showSuccess('Queue item cancelled successfully')
            await this.loadQueue()
          } catch (error) {
            console.error('Error deleting queue item:', error)
            this.showError('Failed to cancel queue item: ' + error.message)
          } finally {
            this.isLoading = false
          }
        },
        
        // Retry failed queue item
        async retryQueueItem(queueItemId) {
          try {
            this.isLoading = true
            
            const response = await fetch(\`\${this.apiUrl}/rest/v1/outline_shopify_queue?id=eq.\${queueItemId}\`, {
              method: 'PATCH',
              headers: {
                'Authorization': \`Bearer \${this.anonKey}\`,
                'apikey': this.anonKey,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                processed_at: null,
                error_message: null
              })
            })
            
            if (!response.ok) {
              throw new Error('Failed to retry queue item')
            }
            
            this.showSuccess('Queue item marked for retry')
            await this.loadQueue()
          } catch (error) {
            console.error('Error retrying queue item:', error)
            this.showError('Failed to retry queue item: ' + error.message)
          } finally {
            this.isLoading = false
          }
        }
      }
    }
  </script>
</body>
</html>`;

// Insert your Supabase URL and anon key
const htmlWithKeys = ADMIN_UI_HTML
  .replace('SUPABASE_URL', supabaseUrl)
  .replace('SUPABASE_ANON_KEY', supabaseKey);

// Main handler function
serve(async (req) => {
  // Set CORS headers for browser compatibility
  const headers = new Headers({
    "Content-Type": "text/html",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  });
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers
    });
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      "Method not allowed",
      { 
        status: 405,
        headers 
      }
    );
  }
  
  // Return the admin UI
  return new Response(
    htmlWithKeys,
    { headers }
  );
});