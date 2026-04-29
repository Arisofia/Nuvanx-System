const { runCLI } = require('jest');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));
const jestConfig = packageJson.jest || {};

async function runTests() {
  const { results } = await runCLI(
    {
      runInBand: true,
      passWithNoTests: true,
      config: JSON.stringify(jestConfig),
      rootDir,
    },
    [rootDir],
  );

  process.exit(results.success ? 0 : 1);
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
