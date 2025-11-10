#!/usr/bin/env node
/**
 * List all loud-articles from Centr to see the structure
 */

const LOUD_API_KEY = process.env.LOUD_API_KEY || 'sk_aD92Fj4mTq8nR7vX0zY1cB6pLw3hK9uE5sN2tG4r';
const HOSTNAME = process.env.HOSTNAME || 'centr.com';

async function listArticles() {
  try {
    const listUrl = `https://${HOSTNAME}/webhooks/v1/loud-articles?code=${LOUD_API_KEY}`;
    
    console.log(`📋 Fetching articles from: ${listUrl}\n`);
    
    const listResponse = await fetch(listUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error(`❌ Failed to fetch articles: ${listResponse.status}`);
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }

    const articlesData = await listResponse.json();
    const articles = Array.isArray(articlesData) ? articlesData : (articlesData.articles || articlesData.data || []);
    
    console.log(`✅ Found ${articles.length} articles\n`);
    console.log('📄 Articles structure:');
    console.log(JSON.stringify(articles, null, 2));
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

listArticles().catch(console.error);

