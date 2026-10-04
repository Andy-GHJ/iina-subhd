// Opt-in network check: node tests/verify-live.cjs [video filename]
const fs = require('node:fs');
const { runtime, nativeExec } = require('./runtime.cjs');

async function main() {
  const filename = process.argv[2] || 'Kill.Bill.Vol.2.2004.1080p.BrRIp.x264.YIFY.mp4';
  const app = runtime({ status: { url: 'file:///tmp/' + encodeURIComponent(filename) } });
  app.iina.utils.exec = nativeExec;
  app.iina.http.get = async (url, options) => {
    const args = ['-sS', '-L', '--connect-timeout', '10', '--max-time', '30'];
    for (const [name, value] of Object.entries(options.headers || {})) args.push('-H', name + ': ' + value);
    args.push('--write-out', '\n%{http_code}', '--', url);
    const result = await nativeExec('/usr/bin/curl', args);
    if (result.status !== 0) throw new Error(result.stderr);
    const boundary = result.stdout.lastIndexOf('\n');
    return { statusCode: Number(result.stdout.slice(boundary + 1)), text: result.stdout.slice(0, boundary) };
  };
  app.iina.http.download = async (url, dest) => {
    const result = await nativeExec('/usr/bin/curl', ['-f', '-sS', '--connect-timeout', '10', '--max-time', '40',
      '--proto', '=https', '--max-filesize', '67108864', '-o', dest, '--', url]);
    if (result.status !== 0) throw new Error(result.stderr);
  };
  try {
    const items = await app.provider.search();
    if (!items.length) throw new Error('Live search returned no subtitles');
    console.log('Search:', items.length, 'results');
    console.log('Selected:', JSON.stringify(app.provider.description(items[0])));
    const paths = await app.provider.download(items[0]);
    for (const path of paths) {
      const bytes = fs.readFileSync(path);
      const text = bytes.toString('utf8');
      const cues = (text.match(/^Dialogue:/gm) || text.match(/-->/g) || []).length;
      console.log('Downloaded:', JSON.stringify({ filename: path.split('/').at(-1), bytes: bytes.length, cues }));
      if (!cues) throw new Error('Downloaded file has no recognizable subtitle cues');
    }
  } finally {
    app.cleanup();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
