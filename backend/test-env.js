const { validate } = require('./src/config/env');
try {
  validate();
  console.log('✅ Configuration validated successfully');
} catch (e) {
  console.error('❌ Validation failed:', e.message);
  process.exit(1);
}
