const tokens = [
  process.env.SUPABASE_ACCESS_TOKEN_1,
  process.env.SUPABASE_ACCESS_TOKEN_2
].filter(Boolean);

async function scan() {
  for (const token of tokens) {
    console.log(`\n--- Token: ${token.substring(0, 10)}... ---`);
    const orgsRes = await fetch('https://api.supabase.com/v1/organizations', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!orgsRes.ok) {
      console.log('  ❌ Orgs fetch failed');
      continue;
    }
    const orgs = await orgsRes.json();
    for (const org of orgs) {
      console.log(`  Org: ${org.name} (${org.id})`);
      const projRes = await fetch('https://api.supabase.com/v1/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const projs = await projRes.json();
      for (const p of projs) {
        if (p.organization_id === org.id) {
          console.log(`    ✅ Proj: ${p.name} (${p.ref}) [${p.status}]`);
        }
      }
    }
  }
}

scan();
