#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mappingPath = path.join(repoRoot, 'docs', 'figma-component-map.json');
const appPath = path.join(repoRoot, 'frontend', 'src', 'App.jsx');

const requiredRoutes = ['/dashboard', '/operativo', '/crm', '/live', '/integrations', '/ai'];

let errorCount = 0;
let warningCount = 0;

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logOk(message) {
  console.log(`[OK] ${message}`);
}

function logWarn(message) {
  warningCount += 1;
  console.log(`[WARN] ${message}`);
}

function logError(message) {
  errorCount += 1;
  console.error(`[ERROR] ${message}`);
}

function normalizeRoute(route) {
  if (!route) return '';
  const trimmed = route.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function ensureFileExists(relativeOrAbsolutePath, kind, label) {
  const resolved = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(repoRoot, relativeOrAbsolutePath);

  if (!fs.existsSync(resolved)) {
    logError(`${kind} "${label}" points to missing file: ${relativeOrAbsolutePath}`);
    return false;
  }
  logOk(`${kind} "${label}" file exists: ${relativeOrAbsolutePath}`);
  return true;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function extractAppRoutes(appSource) {
  const matches = [...appSource.matchAll(/path\s*=\s*["']([^"']+)["']/g)];
  const normalized = matches
    .map((m) => normalizeRoute(m[1]))
    .filter((r) => r && r !== '/*' && r !== '*');

  // Include root route aliases that are represented via index redirect in App.jsx
  normalized.push('/');
  return new Set(normalized);
}

function validateSchema(mapping) {
  const requiredTopLevel = ['version', 'repository', 'figma', 'routes', 'components'];
  for (const key of requiredTopLevel) {
    if (!(key in mapping)) {
      logError(`Mapping file is missing top-level field: ${key}`);
    }
  }

  if (!Array.isArray(mapping.routes)) {
    logError('Mapping field "routes" must be an array.');
  }

  if (!Array.isArray(mapping.components)) {
    logError('Mapping field "components" must be an array.');
  }

  if (Array.isArray(mapping.routes) && mapping.routes.length === 0) {
    logError('Mapping field "routes" cannot be empty.');
  }

  if (Array.isArray(mapping.components) && mapping.components.length === 0) {
    logError('Mapping field "components" cannot be empty.');
  }
}

function validatePlaceholders(mapping) {
  const isTodo = (value) => typeof value === 'string' && value.toUpperCase().includes('TODO');

  const missingRouteNodes = mapping.routes.filter((r) => !r.figmaNodeId || isTodo(r.figmaNodeId));
  const missingComponentNodes = mapping.components.filter((c) => !c.figmaNodeId || isTodo(c.figmaNodeId));

  if (missingRouteNodes.length > 0) {
    logWarn(`Route mappings with TODO node ids: ${missingRouteNodes.map((r) => r.route).join(', ')}`);
  }

  if (missingComponentNodes.length > 0) {
    logWarn(`Component mappings with TODO node ids: ${missingComponentNodes.map((c) => c.name).join(', ')}`);
  }
}

function main() {
  logInfo('Running Figma mapping validation...');

  if (!fs.existsSync(mappingPath)) {
    logError(`Mapping file not found: ${path.relative(repoRoot, mappingPath)}`);
    process.exit(1);
  }

  if (!fs.existsSync(appPath)) {
    logError(`App routes file not found: ${path.relative(repoRoot, appPath)}`);
    process.exit(1);
  }

  let mapping;
  try {
    mapping = readJson(mappingPath);
  } catch (error) {
    logError(`Invalid JSON in docs/figma-component-map.json: ${error.message}`);
    process.exit(1);
  }

  validateSchema(mapping);

  if (errorCount > 0) {
    console.error(`\nValidation failed with ${errorCount} error(s).`);
    process.exit(1);
  }

  const appSource = fs.readFileSync(appPath, 'utf8');
  const appRoutes = extractAppRoutes(appSource);

  // Validate mapped routes and file paths.
  for (const routeEntry of mapping.routes) {
    if (!routeEntry.route || !routeEntry.file) {
      logError('Each route entry must include "route" and "file".');
      continue;
    }

    const normalizedRoute = normalizeRoute(routeEntry.route);
    if (!appRoutes.has(normalizedRoute)) {
      logError(`Mapped route not found in frontend/src/App.jsx: ${normalizedRoute}`);
    } else {
      logOk(`Route exists in frontend/src/App.jsx: ${normalizedRoute}`);
    }

    ensureFileExists(routeEntry.file, 'Route', normalizedRoute);
  }

  // Validate required route coverage.
  const mappedRoutes = new Set(mapping.routes.map((r) => normalizeRoute(r.route)));
  for (const requiredRoute of requiredRoutes) {
    if (!mappedRoutes.has(requiredRoute)) {
      logError(`Required route is missing from mapping file: ${requiredRoute}`);
    }
  }

  // Validate mapped components and file paths.
  for (const componentEntry of mapping.components) {
    if (!componentEntry.name || !componentEntry.file) {
      logError('Each component entry must include "name" and "file".');
      continue;
    }
    ensureFileExists(componentEntry.file, 'Component', componentEntry.name);
  }

  validatePlaceholders(mapping);

  const summary = `\nValidation summary: ${errorCount} error(s), ${warningCount} warning(s).`;
  if (errorCount > 0) {
    console.error(summary);
    process.exit(1);
  }

  console.log(summary);
  console.log('Figma mapping validation passed.');
  process.exit(0);
}

main();
