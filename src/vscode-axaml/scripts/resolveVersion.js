#!/usr/bin/env node
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout && stdout.toString().trim());
    });
  });
}

(async function ensureGitVersion() {
  // If gitversion is available, nothing to do
  try {
    const gv = await run('gitversion --version');
    if (gv) return;
  } catch (e) {}

  // Try alternative executable names
  try {
    const gv = await run('dotnet-gitversion --version');
    if (gv) return;
  } catch (e) {}

  // Attempt to install as a .NET global tool if dotnet exists
  try {
    const dotnet = await run('which dotnet || where dotnet');
    if (dotnet) {
      console.log('gitversion not found; attempting to install GitVersion.Tool as a .NET global tool...');
      // Try install, fall back to update
      await run('dotnet tool install --global GitVersion.Tool') || await run('dotnet tool update --global GitVersion.Tool');
      // Ensure ~/.dotnet/tools is on PATH for subsequent runs
      const dotnetTools = `${process.env.HOME || ''}/.dotnet/tools`;
      if (dotnetTools) {
        process.env.PATH = `${dotnetTools}:${process.env.PATH}`;
      }
    }
  } catch (e) {
    // ignore; we'll fallback to git tags later
  }
})();

(async () => {
  const tryCommands = [
    'gitversion /showvariable SemVer',
    'gitversion /showvariable FullSemVer',
    'gitversion -showvariable SemVer',
    'gitversion --showvariable SemVer',
    'gitversion /output json',
    'gitversion --output json',
    'gitversion -output json',
    'dotnet-gitversion /showvariable SemVer',
    'dotnet-gitversion /output json'
  ];

  let version = null;

  for (const cmd of tryCommands) {
    try {
      const out = await run(cmd);
      if (!out) continue;
      // If JSON, parse
      if (out.startsWith('{')) {
        try {
          const j = JSON.parse(out);
          version = j.FullSemVer || j.SemVer || j.MajorMinorPatch || null;
        } catch (e) {
          // ignore
        }
      } else {
        // Single variable output
        const candidate = out.split('\n')[0].trim();
        if (candidate) {
          version = candidate;
        }
      }
      if (version) break;
    } catch (e) {
      // continue
    }
  }

  if (!version) {
    // Fallback to git tag (vX.Y.Z)
    const gitTag = await run('git describe --tags --abbrev=0 2>/dev/null');
    if (gitTag) {
      version = gitTag.replace(/^v/, '');
    }
  }

  if (!version) {
    console.warn('Could not determine version from GitVersion or tags. Leaving package.json unchanged.');
    process.exit(0);
  }

  // Normalize version (strip whitespace)
  version = version.trim();

  // Basic semver validation
  const semverRegex = /^\d+\.\d+\.\d+(?:[-+].*)?$/;
  if (!semverRegex.test(version)) {
    console.warn(`Resolved version '${version}' does not look like semver. Continuing anyway.`);
  }

  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const old = pkg.version || '<none>';
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`Updated package.json version: ${old} -> ${version}`);
    process.exit(0);
  } catch (e) {
    console.error(`Failed to update package.json: ${e}`);
    process.exit(2);
  }
})();
