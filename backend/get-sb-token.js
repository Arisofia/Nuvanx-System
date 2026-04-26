const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://ssvvuuysgxyqvmovrlvk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NTkwMTQsImV4cCI6MjA2MDIzNTAxNH0.qkCPMBzJfOu2HzCF6OkTz0RLKtSfnFaDXRnONpSbvJo';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function login() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'jenineferderas@hotmail.com',
    password: 'admin'
  });
  
  if (error) {
    console.error('Login failed:', error.message);
    process.exit(1);
  }
  console.log(data.session.access_token);
}

login();
