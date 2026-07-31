/**
 * Metro config for a monorepo.
 *
 * Two things are non-default and both are required:
 *   - `watchFolders` must include the repo root, or edits to `packages/core`
 *     will not trigger a reload.
 *   - `nodeModulesPaths` must list the app's own `node_modules` first, then the
 *     root's, so hoisted dependencies resolve while local ones still win.
 *
 * `disableHierarchicalLookup` prevents Metro from walking further up the tree
 * and accidentally resolving a second copy of React.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
