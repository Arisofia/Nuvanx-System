const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

const supabaseProjects = [
  {
    name: "Project opctgnpvogxvdbixlpnc",
    url: "https://opctgnpvogxvdbixlpnc.supabase.co",
    serviceKey: process.env.SB_SERVICE_KEY_1,
    anonKey: process.env.SB_ANON_KEY_1
  },
  {
    name: "Project zpowfbeftxexzidlxndy",
    url: "https://zpowfbeftxexzidlxndy.supabase.co",
    serviceKey: process.env.SB_SERVICE_KEY_2,
    anonKey: process.env.SB_ANON_KEY_2
  },
  {
    name: "Project pljjgdtczxmrxydfuaep",
    url: "https://pljjgdtczxmrxydfuaep.supabase.co",
    serviceKey: process.env.SB_SERVICE_KEY_3,
    anonKey: process.env.SB_ANON_KEY_3
  },
  {
    name: "Project ssvvuuysgxyqvmovrlvk (Original)",
    url: "https://ssvvuuysgxyqvmovrlvk.supabase.co",
    serviceKey: process.env.SB_SERVICE_KEY_4,
    anonKey: process.env.SB_ANON_KEY_4
  }
];

const metaTokens = [
  process.env.META_TOKEN_1,
  process.env.META_TOKEN_2,
  process.env.META_TOKEN_3,
  process.env.META_TOKEN_4
].filter(Boolean);

const metaSecret = process.env.META_APP_SECRET;

async function checkSupabaseEndpoint(url, key) {
  const sanitizedKey = key.replace(/["']/g, '').trim();
  const res = await fetch(`${url}/rest/v1/leads?limit=1`, {
    headers: {
      'apikey': sanitizedKey,
      'Authorization': `Bearer ${sanitizedKey}`
    }
  });

  if (res.ok) {
    return { ok: true, msg: "Table 'leads' accessible" };
  }

  if (res.status === 404) {
    const res2 = await fetch(`${url}/rest/v1/`, {
      headers: { 'apikey': sanitizedKey, 'Authorization': `Bearer ${sanitizedKey}` }
    });
    if (res2.ok) return { ok: true, msg: "API accessible, but 'leads' table not found" };
    const text = await res2.text();
    return { ok: false, status: res2.status, msg: text };
  }

  const text = await res.text();
  return { ok: false, status: res.status, msg: text };
}

async function testSupabase(p) {
  console.log(`\n--- ${p.name} ---`);
  console.log(`URL: ${p.url}`);
  
  const keys = [
    { name: 'Service Key', val: p.serviceKey },
    { name: 'Anon Key', val: p.anonKey }
  ];

  for (const k of keys) {
    if (!k.val) continue;
    try {
      const result = await checkSupabaseEndpoint(p.url, k.val);
      if (result.ok) {
        console.log(`  ✅ ${k.name}: OK (${result.msg})`);
      } else {
        console.log(`  ❌ ${k.name} Error (${result.status}): ${result.msg.substring(0, 50)}...`);
      }
    } catch (err) {
      console.log(`  ❌ ${k.name} Fatal: ${err.message}`);
      if (err.cause) console.log(`     Cause: ${err.cause.message}`);
    }
  }
}

async function testMeta(token, index) {
  console.log(`\n--- Meta Token ${index + 1} ---`);
  try {
    const url = `https://graph.facebook.com/v19.0/me?access_token=${token}`;
    const res = await fetch(url);
    const json = await res.json();
    
    if (json.error?.message?.includes('appsecret_proof')) {
      const proof = crypto.createHmac('sha256', metaSecret).update(token).digest('hex');
      const res2 = await fetch(`${url}&appsecret_proof=${proof}`);
      const json2 = await res2.json();
      if (json2.error) {
        console.log(`  ❌ Error: ${json2.error.message}`);
      } else {
        console.log(`  ✅ OK (with proof): ID=${json2.id}, Name=${json2.name}`);
      }
    } else if (json.error) {
      console.log(`  ❌ Error: ${json.error.message}`);
    } else {
      console.log(`  ✅ OK (no proof): ID=${json.id}, Name=${json.name}`);
    }
  } catch (err) {
    console.log(`  ❌ Fatal: ${err.message}`);
  }
}

async function main() {
  console.log('--- TESTING SUPABASE PROJECTS ---');
  for (const p of supabaseProjects) {
    await testSupabase(p);
  }

  console.log('\n--- TESTING META TOKENS ---');
  for (let i = 0; i < metaTokens.length; i++) {
    await testMeta(metaTokens[i], i);
  }
}

main();
