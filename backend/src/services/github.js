'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Test a GitHub personal access token.
 * @param {string} token
 * @returns {{ connected: boolean, login?: string, name?: string, error?: string }}
 */
async function testConnection(token) {
  try {
    const { data } = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      timeout: 10000,
    });
    return { connected: true, login: data.login, name: data.name };
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    logger.warn('GitHub testConnection failed', { error: message });
    return { connected: false, error: message };
  }
}

/**
 * List repositories for the authenticated user.
 * @param {string} token
 * @param {{ page?: number, perPage?: number }} options
 */
async function listRepositories(token, { page = 1, perPage = 30 } = {}) {
  const { data } = await axios.get('https://api.github.com/user/repos', {
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    params: { page, per_page: perPage, sort: 'updated' },
    timeout: 15000,
  });
  return data;
}

/**
 * Get open issues / pull requests for a repository.
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 */
async function getIssues(token, owner, repo) {
  const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    params: { state: 'open', per_page: 50 },
    timeout: 15000,
  });
  return data;
}

module.exports = { testConnection, listRepositories, getIssues };
