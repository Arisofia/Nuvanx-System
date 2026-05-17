const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const crypto = require('node:crypto');

dotenv.config();

async function testSupabase() {
  console.log('--- TESTING SUPABASE ---');
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  try {
    const { data, error, count } = await supabase.from('leads').select('*', { count: 'exact', head: true });
    if (error) throw error;
    console.log(`✅ Supabase Connection: OK (Leads count: ${count ?? 0})`);
  } catch (err) {
    console.log(`❌ Supabase Connection: FAILED - ${err.message}`);
    console.log('Details:', err);
  }
}

async function testMeta() {
  console.log('\n--- TESTING META ---');
  const token = process.env.META_ACCESS_TOKEN;
  const rawAdAccountId = process.env.META_AD_ACCOUNT_ID;
  const appSecret = process.env.META_APP_SECRET || process.env.META_SECRET;

  const normalizeId = (id) => {
    const s = String(id || '').trim();
    if (!s) return '';
    const digits = s.replace(/^act_/i, '').replace(/\D/g, '');
    return digits ? `act_${digits}` : '';
  };

  const adAccountIds = String(rawAdAccountId || '').split(/[,;\s]+/).map(normalizeId).filter(Boolean);

  try {
    let url = `https://graph.facebook.com/v22.0/me?access_token=${token}`;
    if (appSecret) {
      const proof = crypto.createHmac('sha256', appSecret).update(token).digest('hex');
      url += `&appsecret_proof=${proof}`;
    }
    
    const res = await fetch(url);
    const json = await res.json();
    
    if (json.error) throw new Error(json.error.message);
    console.log(`✅ Meta Token: OK (User: ${json.name})`);

    for (const adAccountId of adAccountIds) {
      const proof = appSecret ? crypto.createHmac('sha256', appSecret).update(token).digest('hex') : '';
      const adUrl = `https://graph.facebook.com/v22.0/${adAccountId}?fields=name,account_status&access_token=${token}${proof ? '&appsecret_proof=' + proof : ''}`;
      const adRes = await fetch(adUrl);
      const adJson = await adRes.json();
      if (adJson.error) {
        console.log(`❌ Meta Ad Account ${adAccountId}: FAILED - ${adJson.error.message}`);
      } else {
        console.log(`✅ Meta Ad Account ${adAccountId}: OK (Name: ${adJson.name}, Status: ${adJson.account_status})`);
      }
    }
  } catch (err) {
    console.log(`❌ Meta Connection: FAILED - ${err.message}`);
  }
}

async function runTests() {
  await testSupabase();
  await testMeta();
}

runTests();
