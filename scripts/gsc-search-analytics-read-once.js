#!/usr/bin/env node
const { google } = require('googleapis');

async function main() {
  console.log('=== GSC Search Analytics Read-Only Preflight ===');
  
  let auth;
  try {
    auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    
    // Test auth client
    const client = await auth.getClient();
    console.log('[OK] GoogleAuth client initialized successfully.');
  } catch (err) {
    console.error('[FAIL] Failed to initialize GoogleAuth:', err.message);
    process.exit(1);
  }

  const webmasters = google.webmasters({ version: 'v3', auth });

  const siteUrl = 'sc-domain:nuvanx.com';
  console.log(`\nQuerying searchanalytics for site: ${siteUrl}`);
  
  // Date range: last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  
  const formatDate = (d) => d.toISOString().split('T')[0];

  try {
    const res = await webmasters.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensions: ['query', 'device'],
        rowLimit: 5
      }
    });

    console.log('[OK] Search Analytics API responded successfully.');
    console.log('\nTop 5 Queries (Last 30 days):');
    if (res.data.rows && res.data.rows.length > 0) {
      res.data.rows.forEach(row => {
        console.log(`- Query: "${row.keys[0]}" | Device: ${row.keys[1]} | Clicks: ${row.clicks} | Impressions: ${row.impressions} | CTR: ${(row.ctr * 100).toFixed(2)}% | Position: ${row.position.toFixed(1)}`);
      });
    } else {
      console.log('No data found for the specified period.');
    }
  } catch (err) {
    console.error('\n[FAIL] API Query failed. Ensure the Service Account has permissions in Google Search Console for', siteUrl);
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
