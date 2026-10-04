const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const script = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const SRT = '1\n00:00:01,000 --> 00:00:03,500\n中文字幕\n\n2\n01:54:20,000 --> 01:54:23,000\n结束\n';

async function nativeExec(binary, args) {
  try {
    const result = await execFileAsync(binary, Array.from(args), {
      env: { LC_ALL: 'en_US.UTF-8' }, maxBuffer: 4 * 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { status: error.code || 1, stdout: error.stdout || '', stderr: error.stderr || error.message };
  }
}

function runtime(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subhd-test-'));
  const calls = [];
  let provider;
  const prefs = { baseURL: 'https://subhd.tv', fallbackBaseURL: '', ...options.preferences };
  const iina = {
    core: { status: { url: 'file:///tmp/Kill.Bill.Vol.2.2004.1080p.BrRIp.x264.YIFY.mp4', ...options.status } },
    console: { log() {}, warn() {} },
    preferences: {
      get: key => prefs[key],
      set: () => { throw new Error('Preferences should not change during a search'); },
    },
    subtitle: { registerProvider(id, value) { provider = value; }, item: data => ({ data }) },
    file: {
      read: name => fs.readFileSync(name, 'utf8'),
      exists: name => fs.existsSync(name),
      delete: name => fs.unlinkSync(name),
      handle(name) {
        const contents = fs.readFileSync(name);
        return { read: size => contents.subarray(0, size), close() {} };
      },
    },
    http: {
      async get(url, request) {
        calls.push({ type: 'get', url, request });
        return options.get ? options.get(url, request) : { statusCode: 200, text: '' };
      },
      async download(url, dest, request) {
        calls.push({ type: 'download', url, dest });
        if (options.download) return options.download(url, dest, request);
        if (options.archive) fs.copyFileSync(options.archive, dest);
        else fs.writeFileSync(dest, options.contents || SRT);
      },
    },
    utils: {
      resolvePath: name => path.join(root, name.replace(/^@tmp\//, '')),
      async exec(binary, args) {
        args = Array.from(args);
        calls.push({ type: 'exec', binary, args });
        if (options.exec) return options.exec(binary, args);
        if (binary !== '/usr/bin/curl') return nativeExec(binary, args);
        const url = args.at(-1);
        const body = args.includes('--data') ? JSON.parse(args[args.indexOf('--data') + 1]) : null;
        const sid = body?.sid || 'Ab12';
        let contents;
        if (url.endsWith('/api/sub/prepare-download')) contents = { success: true, url: `/down/${sid}` };
        else if (url.endsWith('/api/sub/down')) contents = {
          success: true, pass: true, url: options.downloadURL || `https://dl.subhd.me/subtitle.${options.archive ? 'zip' : 'srt'}`,
        };
        else contents = '<button data-sid="Ab12"></button><script src="/cloudflare-static/email-decode.min.js"></script>';
        fs.writeFileSync(args[args.indexOf('--output') + 1], typeof contents === 'string' ? contents : JSON.stringify(contents));
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  };
  vm.runInNewContext(script, { iina });
  return { provider, calls, iina, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function card({ id = 'Ab12', title = 'Kill.Bill.Vol.2.2004.BluRay', language = '简体 英语 双语', format = 'SRT', downloads = 1234 } = {}) {
  return `<div class="bg-white mb-4"><div><div class="view-text"><a href="/a/${id}">${title}</a></div>
    <div>${language} ${format}</div><svg class="bi bi-download"></svg><span>${downloads}</span></div></div>`;
}

module.exports = { runtime, nativeExec, card, SRT };
