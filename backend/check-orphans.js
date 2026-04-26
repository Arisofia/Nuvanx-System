const { pool } = require('./src/db');

async function checkOrphans() {
  const ids = [
    'cadf0cd6-cc44-4d66-864a-5bb687bfd4f5',
    'daf201c7-3641-48b9-bb8b-47082f2ece64'
  ];
  
  try {
    const { rows: publicUsers } = await pool.query('SELECT id, email FROM users WHERE id = ANY($1)', [ids]);
    console.log('Public Users Found:', publicUsers);
    
    // We can't query auth.users directly via pool if it's restricted, but let's try.
    try {
      const { rows: authUsers } = await pool.query('SELECT id FROM auth.users WHERE id = ANY($1)', [ids]);
      console.log('Auth Users Found:', authUsers);
    } catch (e) {
      console.log('Cannot query auth.users directly (expected):', e.message);
    }
    
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

checkOrphans();
