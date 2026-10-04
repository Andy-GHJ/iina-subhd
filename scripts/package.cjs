// Build a minimal IINA plugin archive using macOS's built-in zip/unzip tools.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Info.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) {
  throw new Error('Info.json must contain a valid plugin version');
}
const files = ['Info.json', 'main.js', 'preferences.html', 'LICENSE'];
assert.equal(manifest.entry, 'main.js');
assert.equal(manifest.preferencesPage, 'preferences.html');
const output = path.join(root, 'artifacts');
fs.mkdirSync(output, { recursive: true });
const filename = `SubHD-${manifest.version}.iinaplgz`;
const archive = path.join(output, filename);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'subhd-package-'));
try {
  for (const file of files) fs.copyFileSync(path.join(root, file), path.join(stage, file));
  fs.rmSync(archive, { force: true });
  execFileSync('/usr/bin/zip', ['-X', '-q', archive, ...files], { cwd: stage });
  const entries = execFileSync('/usr/bin/unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(entries.sort(), [...files].sort());
  for (const file of files) {
    assert.deepEqual(execFileSync('/usr/bin/unzip', ['-p', archive, file]), fs.readFileSync(path.join(root, file)));
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${hash}  ${filename}\n`);
  console.log(`Created and verified ${path.relative(root, archive)}`);
  console.log(`${hash}  ${filename}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
