const teamId = 'team_R0GOR4jvw1c1gnyBRWYu32O7';
const projectId = 'prj_IAOBlV17HeS22KuEfsdkDrGMV9Ze';
const token = process.env.VERCEL_TOKEN;

async function listEnv() {
  if (!token) {
    throw new Error('Missing VERCEL_TOKEN environment variable.');
  }

  const url = `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Vercel API error ${response.status}: ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify(data, null, 2));
}

listEnv().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
