const axios = require('axios');
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImEyZjJiOGExLWZlZGItNGE3NC04OTFkLWI4YTIwODlmZDQ5YSIsImVtYWlsIjoiamVuaW5lZmVyZGVyYXNAaG90bWFpbC5jb20iLCJuYW1lIjoiQWRtaW4iLCJpYXQiOjE3NzcyNDM4NzcsImV4cCI6MTc3NzI0NzQ3N30.eu2cPDBKR38pOt0FjfZSqrDo7coCWISNdZWJhGUaRQY';

async function test() {
  try {
    const res = await axios.post('https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/ai/generate', 
      { prompt: 'Di hola', provider: 'gemini' },
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('SUCCESS:', res.data);
  } catch (err) {
    console.log('STATUS:', err.response?.status);
    console.log('BODY:', JSON.stringify(err.response?.data, null, 2));
  }
}

test();
