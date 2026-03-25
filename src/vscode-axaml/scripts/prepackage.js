const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, opts = {}) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const extDir = path.resolve(__dirname, '..');

try {
  console.log('Publishing servers as framework-dependent (smaller)...');
  const axsgProj = path.join(repoRoot, 'src', 'XamlToCSharpGenerator', 'src', 'XamlToCSharpGenerator.LanguageServer', 'XamlToCSharpGenerator.LanguageServer.csproj');
  if (fs.existsSync(axsgProj)) {
    const out = path.join(extDir, 'axsgServer');
    if (fs.existsSync(out)) {
      console.log('Removing existing output:', out);
      fs.rmSync(out, { recursive: true, force: true });
    }
    fs.mkdirSync(out, { recursive: true });
    run(`dotnet publish "${axsgProj}" -c Release --nologo -o "${out}" -p:SelfContained=false`);
  }

  const axamlProj = path.join(repoRoot, 'src', 'AxamlLSP', 'AxamlLanguageServer', 'AxamlLanguageServer.csproj');
  if (fs.existsSync(axamlProj)) {
    const out = path.join(extDir, 'axamlServer');
    if (fs.existsSync(out)) {
      console.log('Removing existing output:', out);
      fs.rmSync(out, { recursive: true, force: true });
    }
    fs.mkdirSync(out, { recursive: true });
    run(`dotnet publish "${axamlProj}" -c Release --nologo -o "${out}" -p:SelfContained=false`);
  }

  const solProj = path.join(repoRoot, 'src', 'SolutionParser', 'SolutionParser.csproj');
  if (fs.existsSync(solProj)) {
    const out = path.join(extDir, 'solutionParserTool');
    if (fs.existsSync(out)) {
      console.log('Removing existing output:', out);
      fs.rmSync(out, { recursive: true, force: true });
    }
    fs.mkdirSync(out, { recursive: true });
    run(`dotnet build "${solProj}" -c Release --nologo -o "${out}"`);
  }

  console.log('Cleaning published server folders to reduce VSIX size...');
  const locales = ['cs','de','es','fr','it','ja','ko','pl','pt-BR','ru','zh-Hans','zh-Hant','tr'];
  ['axsgServer','axamlServer'].forEach(s => {
    const target = path.join(extDir, s);
    if (!fs.existsSync(target)) return;
    locales.forEach(l => {
      const p = path.join(target, l);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    });
    const runtimes = path.join(target, 'runtimes');
    if (fs.existsSync(runtimes)) fs.rmSync(runtimes, { recursive: true, force: true });

    // remove pdb and xml files
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (full.endsWith('.pdb') || full.endsWith('.xml')) fs.rmSync(full, { force: true });
      }
    })(target);
  });

  console.log('Prepackage completed.');
} catch (err) {
  console.error('prepackage failed:', err);
  process.exit(1);
}
