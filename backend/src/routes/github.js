'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const integrationModel = require('../models/integration');
const githubService = require('../services/github');
const { supabaseFigmaAdmin } = require('../config/supabase');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * Resolve the GitHub credential for the requesting user.
 * Priority: per-user vault → GITHUB_TOKEN env var.
 */
async function resolveGitHubCredential(userId) {
  const stored = await credentialModel.getDecryptedKey(userId, 'github');
  if (stored) return stored;
  return config.githubToken || null;
}

/**
 * GET /api/github/repos
 * Lists GitHub repositories for the authenticated user.
 */
router.get('/repos', async (req, res, next) => {
  try {
    const token = await resolveGitHubCredential(req.user.id);
    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'GitHub integration not connected. Please connect GitHub in Integrations.',
      });
    }

    const { page = 1, perPage = 30 } = req.query;
    const repos = await githubService.listRepositories(token, {
      page: parseInt(page, 10),
      perPage: Math.min(parseInt(perPage, 10), 100),
    });

    res.json({
      success: true,
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        htmlUrl: r.html_url,
        language: r.language,
        openIssuesCount: r.open_issues_count,
        stargazersCount: r.stargazers_count,
        forksCount: r.forks_count,
        updatedAt: r.updated_at,
        defaultBranch: r.default_branch,
      })),
    });
  } catch (err) {
    logger.error('GitHub repos error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

/**
 * GET /api/github/repos/:owner/:repo/issues
 * Lists open issues for a specific repository.
 */
router.get('/repos/:owner/:repo/issues', async (req, res, next) => {
  try {
    const token = await resolveGitHubCredential(req.user.id);
    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'GitHub integration not connected. Please connect GitHub in Integrations.',
      });
    }

    const { owner, repo } = req.params;
    const issues = await githubService.getIssues(token, owner, repo);

    res.json({
      success: true,
      issues: issues.map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        htmlUrl: i.html_url,
        labels: (i.labels || []).map((l) => l.name),
        user: i.user?.login,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        isPullRequest: Boolean(i.pull_request),
      })),
    });
  } catch (err) {
    logger.error('GitHub issues error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

/**
 * POST /api/github/sync
 * Fetches GitHub repository and issue data and persists the snapshot to
 * monitoring.operational_events in the Figma Supabase project so that
 * the data is available for Figma consumption and the LiveDashboard feed.
 *
 * Body (optional):
 *   { owner: string, repo: string }  — if supplied, also syncs issues for that repo
 */
router.post('/sync', async (req, res, next) => {
  try {
    const token = await resolveGitHubCredential(req.user.id);
    if (!token) {
      return res.status(404).json({
        success: false,
        message: 'GitHub integration not connected. Please connect GitHub in Integrations.',
      });
    }

    // Fetch repos
    const repos = await githubService.listRepositories(token, { perPage: 50 });

    // Optionally fetch issues for a specific repo
    let issues = [];
    const { owner, repo } = req.body || {};
    if (owner && repo) {
      issues = await githubService.getIssues(token, owner, repo);
    }

    const syncedAt = new Date().toISOString();
    const repoCount = repos.length;
    const openIssueCount = issues.filter((i) => i.state === 'open' && !i.pull_request).length;
    const openPrCount = issues.filter((i) => i.pull_request).length;

    const summary = [
      `${repoCount} repo${repoCount !== 1 ? 's' : ''}`,
      owner && repo ? `${openIssueCount} open issue${openIssueCount !== 1 ? 's' : ''} in ${owner}/${repo}` : null,
      owner && repo && openPrCount > 0 ? `${openPrCount} open PR${openPrCount !== 1 ? 's' : ''}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    const metadata = {
      syncedAt,
      repoCount,
      repos: repos.slice(0, 10).map((r) => ({
        name: r.full_name,
        language: r.language,
        openIssues: r.open_issues_count,
        updatedAt: r.updated_at,
      })),
      ...(owner && repo && {
        targetRepo: `${owner}/${repo}`,
        openIssueCount,
        openPrCount,
        issues: issues.slice(0, 20).map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          isPr: Boolean(i.pull_request),
          createdAt: i.created_at,
        })),
      }),
    };

    // Persist the event to the Figma monitoring project
    if (supabaseFigmaAdmin) {
      const { error: eventError } = await supabaseFigmaAdmin
        .schema('monitoring')
        .from('operational_events')
        .insert({
          user_id: req.user.id,
          event_type: 'github_sync',
          message: `GitHub sync: ${summary}`,
          metadata,
        });

      if (eventError) {
        logger.warn('Failed to write GitHub sync event to Supabase', { error: eventError.message });
      }
    }

    // Update integration record with latest sync timestamp
    await integrationModel.upsert(req.user.id, 'github', {
      status: 'connected',
      lastSync: syncedAt,
      lastError: null,
      metadata: {
        repoCount,
        ...(owner && repo && { targetRepo: `${owner}/${repo}`, openIssueCount }),
      },
    });

    logger.info('GitHub sync completed', { userId: req.user.id, repoCount, openIssueCount });

    res.json({
      success: true,
      message: `GitHub sync completed: ${summary}`,
      syncedAt,
      repoCount,
      openIssueCount,
      openPrCount,
    });
  } catch (err) {
    logger.error('GitHub sync error', { userId: req.user.id, error: err.message });
    next(err);
  }
});

module.exports = router;
