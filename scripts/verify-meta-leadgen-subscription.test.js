'use strict';

const assert = require('assert/strict');
const {
  buildAppSecretProof,
  classifySubscription,
  createSubscribedAppsUrl,
  inspectLeadgenSubscription,
} = require('./verify-meta-leadgen-subscription');

async function testBuildsGetOnlySubscribedAppsRequest() {
  const token = 'token-value-123';
  const secret = 'app-secret-456';
  const url = createSubscribedAppsUrl({
    accessToken: token,
    pageId: '685010274687129',
    appSecret: secret,
    graphVersion: 'v22.0',
  });

  assert.equal(url.pathname, '/v22.0/685010274687129/subscribed_apps');
  assert.equal(url.searchParams.get('fields'), 'id,name,subscribed_fields');
  assert.equal(url.searchParams.get('access_token'), token);
  assert.equal(url.searchParams.get('appsecret_proof'), buildAppSecretProof(token, secret));
}

async function testClassifiesLeadgenSubscription() {
  const result = classifySubscription({
    data: [
      { id: 'app-1', name: 'One', subscribed_fields: ['feed'] },
      { id: 'app-2', name: 'Two', subscribed_fields: ['leadgen', 'messages'] },
    ],
  }, 'app-2');

  assert.equal(result.apps.length, 2);
  assert.equal(result.leadgenSubscribed, true);
  assert.equal(result.leadgenApps.length, 1);
  assert.equal(result.expectedAppFound, true);
  assert.equal(result.expectedAppLeadgenSubscribed, true);
}

async function testDetectsMissingLeadgen() {
  const result = classifySubscription({
    data: [{ id: 'app-1', name: 'One', subscribed_fields: ['feed', 'messages'] }],
  });
  assert.equal(result.leadgenSubscribed, false);
  assert.equal(result.leadgenApps.length, 0);
}

async function testInspectorNeverMutatesMeta() {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [{ id: 'app-2', name: 'Two', subscribed_fields: ['leadgen'] }] };
      },
    };
  };

  const result = await inspectLeadgenSubscription({
    accessToken: 'token-value-123',
    pageId: '685010274687129',
    fetchImpl,
  });

  assert.equal(result.leadgenSubscribed, true);
  assert.match(capturedUrl, /\/subscribed_apps\?/);
  assert.equal(capturedOptions.method, 'GET');
  assert.deepEqual(Object.keys(capturedOptions.headers), ['Accept']);
}

async function run() {
  await testBuildsGetOnlySubscribedAppsRequest();
  await testClassifiesLeadgenSubscription();
  await testDetectsMissingLeadgen();
  await testInspectorNeverMutatesMeta();
  console.log('verify-meta-leadgen-subscription tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
