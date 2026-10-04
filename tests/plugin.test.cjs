const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runtime, nativeExec, card, SRT } = require('./runtime.cjs');

test('normal Cloudflare email protection does not block native search results', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text: card() +
    '<script src="/cdn-cgi/scripts/cloudflare-static/email-decode.min.js"></script>' +
    '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>' }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(items.length, 1);
  const desc = app.provider.description(items[0]);
  assert.equal(desc.left, '中英双语 · SRT');
  assert.equal(desc.right, '下载 1234 次');
  assert.equal(app.calls[0].url, 'https://subhd.tv/search/Kill%20Bill%20Vol%202');
});

test('a real challenge retries the mirror without changing saved preferences', async t => {
  const app = runtime({ preferences: { fallbackBaseURL: 'https://subhd.me' }, get: url => ({
    statusCode: 200, text: url.startsWith('https://subhd.tv') ? '<title>Just a moment...</title><div id="challenge-form"></div>' : card(),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(items[0].data.site, 'https://subhd.me');
  assert.equal(app.calls.filter(c => c.type === 'get').length, 2);
});

test('clearing the backup site actually disables it and HTTP errors remain readable', async t => {
  const app = runtime({ get: () => Promise.reject({ statusCode: 503, reason: 'Service Unavailable' }) });
  t.after(app.cleanup);
  await assert.rejects(app.provider.search(), /HTTP 503 Service Unavailable/);
  assert.equal(app.calls.length, 1);
});

test('wrong volume and English-only rows are filtered or ranked below matching results', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text:
    card({ id: 'Vol1', title: 'Kill.Bill.Volume.1.2003' }) +
    card({ id: 'En', language: '英语', title: 'Kill.Bill.Vol.2.2004' }) + card(),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(items.length, 2);
  assert.equal(items[0].data.detailPath, '/a/Ab12');
});

test('episode identifiers and numeric movie titles survive filename cleanup', async t => {
  for (const [name, query] of [['Show.Name.S02E03.1080p.WEB-DL.mkv', 'Show Name S02E03'], ['1917.2019.1080p.mkv', '1917']]) {
    const app = runtime({ status: { url: 'file:///tmp/' + name }, get: () => ({ statusCode: 200, text: card() }) });
    t.after(app.cleanup);
    await app.provider.search();
    assert.equal(decodeURIComponent(app.calls[0].url.split('/search/')[1]), query);
  }
});

test('missing video information rejects asynchronously as required by IINA', async t => {
  const app = runtime({ status: { url: '', title: '' } });
  t.after(app.cleanup);
  await assert.rejects(app.provider.search(), /当前影片标题/);
});

const item = { data: { site: 'https://subhd.tv', detailPath: '/a/Ab12' } };

test('complete download uses JSON and the same anonymous session, with no preview API', async t => {
  const app = runtime();
  t.after(app.cleanup);
  const paths = await app.provider.download(item);
  assert.equal(fs.readFileSync(paths[0], 'utf8'), SRT);
  const requests = app.calls.filter(c => c.binary === '/usr/bin/curl');
  assert.deepEqual(requests.map(c => new URL(c.args.at(-1)).pathname), ['/a/Ab12', '/api/sub/prepare-download', '/down/Ab12', '/api/sub/down']);
  const jars = requests.map(c => c.args[c.args.indexOf('--cookie-jar') + 1]);
  assert.equal(new Set(jars).size, 1);
  assert.equal(fs.existsSync(jars[0]), false);
  for (const request of requests.filter(c => c.args.includes('--data'))) {
    assert.equal(request.args[request.args.indexOf('--data') + 1], '{"sid":"Ab12"}');
    assert.ok(request.args.includes('Content-Type: application/json'));
  }
});

test('HTML disguised as a subtitle is rejected', async t => {
  const app = runtime({ contents: '<!DOCTYPE html><html>Verify your request</html>' });
  t.after(app.cleanup);
  await assert.rejects(app.provider.download(item), /不是有效的 SRT/);
});

test('download URL cannot send requests to arbitrary hosts or downgrade HTTPS', async t => {
  for (const url of ['https://evil.example/file.srt', 'http://dl.subhd.me/file.srt', 'https://dl.subhd.me@evil.example/file.srt']) {
    const app = runtime({ downloadURL: url });
    t.after(app.cleanup);
    await assert.rejects(app.provider.download(item), /不受支持的下载域名/);
    assert.equal(app.calls.filter(c => c.type === 'download').length, 0);
  }
});

test('compressed subtitles keep original bytes and handle brackets and shell punctuation safely', async t => {
  const app = runtime();
  t.after(app.cleanup);
  const source = path.join(app.root, 'source');
  fs.mkdirSync(source);
  const name = '[简体] movie $(echo injected).chs.srt';
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SRT, 'utf16le')]);
  fs.writeFileSync(path.join(source, name), bytes);
  fs.writeFileSync(path.join(source, 'movie.eng.srt'), SRT.replace('中文字幕', 'English'));
  const archive = path.join(app.root, 'sample.zip');
  const packed = await nativeExec('/usr/bin/bsdtar', ['--format', 'zip', '-cf', archive, '-C', source, '.']);
  assert.equal(packed.status, 0);
  app.iina.http.download = async (_, dest) => fs.copyFileSync(archive, dest);
  // Keep the real helper execution and override only the JSON download URL.
  const original = app.iina.utils.exec;
  app.iina.utils.exec = async (binary, args) => {
    const result = await original(binary, args);
    if (binary === '/usr/bin/curl' && args.at(-1).endsWith('/api/sub/down')) {
      fs.writeFileSync(args[args.indexOf('--output') + 1], JSON.stringify({ success: true, pass: true, url: 'https://dl.subhd.me/sample.zip' }));
    }
    return result;
  };
  const paths = await app.provider.download(item);
  assert.deepEqual(fs.readFileSync(paths[0]), bytes);
  assert.equal(fs.readdirSync(path.dirname(paths[0])).filter(name => name.endsWith('.srt')).length, 1);
});
