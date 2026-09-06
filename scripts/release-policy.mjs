import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const START_MARKER = '<!-- release-notes:start -->';
const END_MARKER = '<!-- release-notes:end -->';
const REQUIRED_SECTIONS = [
  'Summary',
  'Breaking changes and migration',
  'Upgrade notes',
  'Validation',
  'Known issues',
];

export function parseVersion(value) {
  const match = STRICT_VERSION.exec(value);
  if (!match) throw new Error(`Release versions must use X.Y.Z without a prefix; received "${value}"`);
  return { raw: value, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function classifyTransition(previousValue, currentValue) {
  const previous = parseVersion(previousValue);
  const current = parseVersion(currentValue);
  if (current.major === previous.major + 1 && current.minor === 0 && current.patch === 0) return 'FU';
  if (current.major === previous.major && current.minor === previous.minor + 1 && current.patch === 0) return 'FU';
  if (current.major === previous.major && current.minor === previous.minor && current.patch === previous.patch + 1) return 'PU';
  throw new Error(`Invalid release transition ${previousValue} -> ${currentValue}; increment exactly one SemVer component and reset components to its right`);
}

export function extractReleaseNotes(readme, version, releaseType) {
  const starts = readme.split(START_MARKER).length - 1;
  const ends = readme.split(END_MARKER).length - 1;
  if (starts !== 1 || ends !== 1) throw new Error('README must contain exactly one release-notes marker pair');
  const start = readme.indexOf(START_MARKER) + START_MARKER.length;
  const end = readme.indexOf(END_MARKER, start);
  if (end < start) throw new Error('README release-notes markers are out of order');
  const notes = readme.slice(start, end).trim();
  const expectedTitle = `## ${releaseType} — EmuFramework v${version}`;
  if (!notes.startsWith(expectedTitle)) throw new Error(`Release notes must begin with "${expectedTitle}"`);
  for (const section of REQUIRED_SECTIONS) {
    if (!notes.includes(`### ${section}`)) throw new Error(`Release notes are missing the "${section}" section`);
  }
  if (!notes.includes('### Improvements') && !notes.includes('### Fixes')) {
    throw new Error('Release notes must include an Improvements or Fixes section');
  }
  return `${notes}\n`;
}

export function validateRepositoryVersions(root, expectedVersion) {
  const manifests = ['package.json', 'packages/client/package.json', 'packages/core/package.json', 'packages/server/package.json'];
  for (const relativePath of manifests) {
    const manifest = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
    if (manifest.version !== expectedVersion) throw new Error(`${relativePath} has version ${manifest.version}; expected ${expectedVersion}`);
  }
  const sourceChecks = [
    ['packages/core/src/index.ts', /CORE_VERSION\s*=\s*['"]([^'"]+)['"]/],
    ['packages/core/src/metadata/workspace.ts', /version:\s*['"]([^'"]+)['"]/],
  ];
  for (const [relativePath, pattern] of sourceChecks) {
    const match = pattern.exec(readFileSync(join(root, relativePath), 'utf8'));
    if (!match || match[1] !== expectedVersion) throw new Error(`${relativePath} must expose version ${expectedVersion}`);
  }
}

export function selectPreviousVersion(tags, currentVersion) {
  const candidates = tags
    .filter((tag) => STRICT_VERSION.test(tag) && tag !== currentVersion)
    .filter((tag) => compareVersions(tag, currentVersion) < 0)
    .sort(compareVersions);
  if (!candidates.length) throw new Error(`No earlier X.Y.Z tag exists before ${currentVersion}`);
  return candidates.at(-1);
}

function parseArguments(argv) {
  const options = { tag: process.env.GITHUB_REF_NAME, output: undefined, previous: undefined, versionsOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--versions-only') options.versionsOnly = true;
    else if (['--tag', '--output', '--previous'].includes(argument)) options[argument.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function repositoryTags(root) {
  return execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

export function run(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseArguments(argv);
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  parseVersion(packageVersion);
  validateRepositoryVersions(root, packageVersion);
  if (options.versionsOnly) {
    process.stdout.write(`Repository versions are consistent at ${packageVersion}.\n`);
    return;
  }
  const tag = options.tag ?? packageVersion;
  parseVersion(tag);
  if (tag !== packageVersion) throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`);
  const previous = options.previous ?? selectPreviousVersion(repositoryTags(root), tag);
  const releaseType = classifyTransition(previous, tag);
  const notes = extractReleaseNotes(readFileSync(join(root, 'README.md'), 'utf8'), tag, releaseType);
  if (options.output) {
    const outputPath = resolve(root, options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, notes, 'utf8');
  }
  const releaseName = `${releaseType} — EmuFramework v${tag}`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `release_type=${releaseType}\nrelease_name=${releaseName}\nprevious_version=${previous}\n`);
  }
  process.stdout.write(`${releaseName} validated against ${previous}.\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try { run(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
