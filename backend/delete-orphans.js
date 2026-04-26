const { pool } = require('./src/db');

async function deleteOrphans() {
  const ids = [
    'cadf0cd6-cc44-4d66-864a-5bb687bfd4f5',
    'daf201c7-3641-48b9-bb8b-47082f2ece64'
  ];
  
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    console.log(`Deleted ${rowCount} orphaned users.`);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

deleteOrphans();
