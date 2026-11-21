#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PKG_FILES = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'server/package.json'),
  path.join(ROOT, 'client/package.json'),
];

const args = process.argv.slice(2);
const shouldPush = args.includes('--push');
const targetArg = args.find((a) => !a.startsWith('--'));

if (!targetArg) {
  console.error('Usage: npm run release -- <patch|minor|major|X.Y.Z|vX.Y.Z> [--push]');
  process.exit(1);
}

const rootPkg = JSON.parse(fs.readFileSync(PKG_FILES[0], 'utf8'));
const currentVersion = String(rootPkg.version || '1.0.0');
const semverMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
if (!semverMatch) {
  console.error(`Invalid current version in package.json: ${currentVersion}`);
  process.exit(1);
}

let [, maj, min, pat] = semverMatch.map((v, i) => (i > 0 ? parseInt(v, 10) : v));
let nextVersion;

if (targetArg === 'major') {
  nextVersion = `${maj + 1}.0.0`;
} else if (targetArg === 'minor') {
  nextVersion = `${maj}.${min + 1}.0`;
} else if (targetArg === 'patch') {
  nextVersion = `${maj}.${min}.${pat + 1}`;
} else {
  const cleaned = targetArg.replace(/^v/i, '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cleaned)) {
    console.error(`Invalid semver version "${targetArg}". Expected e.g. 1.1.1, v1.1.1, patch, minor, or major.`);
    process.exit(1);
  }
  nextVersion = cleaned;
}

const tag = `v${nextVersion}`;

for (const filePath of PKG_FILES) {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  pkg.version = nextVersion;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

console.log(`Updated version: ${currentVersion} -> ${nextVersion}`);

function runGit(gitArgs) {
  execFileSync('git', gitArgs, { cwd: ROOT, stdio: 'inherit' });
}

runGit(['add', 'package.json', 'server/package.json', 'client/package.json']);

let hasStagedChanges = true;
try {
  execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
  hasStagedChanges = false;
} catch {
  hasStagedChanges = true;
}

if (hasStagedChanges) {
  runGit(['commit', '-m', `chore(release): ${tag}`]);
}

runGit(['tag', '-a', tag, '-m', `Release ${tag}`]);
console.log(`Created git tag ${tag}`);

if (shouldPush) {
  runGit(['push', 'origin', 'HEAD']);
  runGit(['push', 'origin', tag]);
  console.log(`Pushed ${tag} to origin (Release & GHCR Docker workflows triggered).`);
} else {
  console.log(`Run: git push origin main && git push origin ${tag}`);
}
