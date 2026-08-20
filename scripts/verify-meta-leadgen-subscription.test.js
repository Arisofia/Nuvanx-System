'use strict';

const assert = require('assert/strict');
const {
  MetaSubscriptionError,
  buildAppSecretProof,
  classifySubscription,
  createSubscribedAppsUrl,
  createSystemUserAccountsUrl,
  inspectLeadgenSubscription,
  selectPageAccessToken,
} = require('./verify-meta-leadgen-subscription');

async function testBuildsSystemUserAccountsRequest() {
  const token = 'system-user-token-123';
  const secret = 'app-secret-456';
  const url = createSystemUserAccountsUrl({
    systemUserAccessToken: token,
    systemUserId: '61569256954284',
    appSecret: secret,
    graphVersion: 'v22.0',
  });
  assert.equal(url.pathname, '/v22.0/61569256954284/accounts');
  assert.equal(url.searchParams.get('fields'), 'id,name,access_token');
  assert.equal(url.searchParams.get('access_token'), token);
  assert.equal(url.searchParams.get('appsecret_proof'), buildAppSecretProof(token, secret));
}

async function testBuildsPageSubscribedAppsRequest() {
  const token = 'page-token-789';
  const secret = 'app-secret-456';
  const url = createSubscribedAppsUrl({
    pageAccessToken: token,
    pageId: '685010274687129',
    appSecret: secret,
    graphVersion: 'v22.0',
  });
  assert.equal(url.pathname, '/v22.0/685010274687129/subscribed_apps');
  assert.equal(url.searchParams.get('fields'), 'id,name,subscribed_fields');
  assert.equal(url.searchParams.get('access_token'), token);
  assert.equal(url.searchParams.get('appsecret_proof'), buildAppSecretProof(token, secret));
}

async function testSelectsPageAccessTokenWithoutExposingItInResult() {
  const page = selectPageAccessToken({
    data: [
      { id: '111', name: 'Other', access_token: 'other-token' },
      { id: '685010274687129', name: 'Nuvanx', access_token: 'page-token-secret' },
    ],
  }, '685010274687129');
  assert.equal(page.id, '685010274687129');
  assert.equal(page.name, 'Nuvanx');
  assert.equal(page.accessToken, 'page-token-secret');
}

async function testRejectsMissingAssignedPage() {
  assert.throws(
    () => selectPageAccessToken({ data: [{ id: '111', access_token: 'x' }] }, '685010274687129'),
    MetaSubscriptionError,
  );
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

async function testInspectorUsesTwoGetOnlyRequests() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ id: '685010274687129', name: 'Nuvanx', access_token: 'page-token-secret' }] };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { data: [{ id: 'app-2', name: 'NUVANX_SYSTEM', subscribed_fields: ['leadgen'] }] };
      },
    };
  };

  const result = await inspectLeadgenSubscription({
    systemUserAccessToken: 'system-token-secret',
    systemUserId: '61569256954284',
    pageId: '685010274687129',
    fetchImpl,
  });

  assert.equal(result.leadgenSubscribed, true);
  assert.deepEqual(result.page, { id: '685010274687129', name: 'Nuvanx' });
  assert.equal(Object.hasOwn(result.page, 'accessToken'), false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/61569256954284\/accounts\?/);
  assert.match(calls[1].url, /\/685010274687129\/subscribed_apps\?/);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.deepEqual(Object.keys(call.options.headers), ['Accept']);
  }
}

async function run() {
  await testBuildsSystemUserAccountsRequest();
  await testBuildsPageSubscribedAppsRequest();
  await testSelectsPageAccessTokenWithoutExposingItInResult();
  await testRejectsMissingAssignedPage();
  await testClassifiesLeadgenSubscription();
  await testDetectsMissingLeadgen();
  await testInspectorUsesTwoGetOnlyRequests();
  console.log('verify-meta-leadgen-subscription tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
