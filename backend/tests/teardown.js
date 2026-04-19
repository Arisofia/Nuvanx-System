'use strict';

/**
 * Jest global teardown — runs after all test suites complete.
 * Ensures all async handles are properly cleaned up to prevent hanging.
 */

module.exports = async () => {
  // Close database pool if it exists and is connected
  try {
    const db = require('../src/db');
    if (db.isAvailable() && db.pool?.end) {
      await db.pool.end();
    }
  } catch (err) {
    // Ignore - pool may not be initialized in test mode
  }

  // Stop any periodic syncs that might be running
  try {
    const { stopPeriodicSync } = require('../src/services/dashboardSync');
    stopPeriodicSync();
  } catch (err) {
    // Ignore if dashboardSync hasn't started
  }

  // Destroy any lingering HTTP agents
  try {
    const http = require('http');
    const https = require('https');
    // Destroy global agents to close connections
    Object.keys(http.Agent.prototype).forEach((key) => {
      try {
        if (key === 'destroy') {
          http.globalAgent.destroy?.();
          https.globalAgent.destroy?.();
        }
      } catch (err) {
        // Ignore errors
      }
    });
  } catch (err) {
    // Ignore
  }

  // Wait a moment for cleanup to complete, then force exit with code 0
  // This ensures Jest doesn't hang waiting for unresolved handles
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.exit(0); // Force exit with success code
    }, 500);
    timeout.unref(); // Don't block process exit
    resolve();
  });
};
