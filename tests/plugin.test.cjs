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
  assert.equal(app.calls[0].url, 'https://subhd.tv/search/Kill%20Bill%20Vol%202%202004');
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

test('official badges and named groups appear before language and format in native rows', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text:
    card({ id: 'Official', source: '官方字幕' }) +
    card({ id: 'Group', group: 'CMCT字幕组' }) +
    card({ id: 'Both', source: '官方字幕', group: 'F.I.X字幕侠', groupURL: 'https://subhd.me/zu/28' }),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.deepEqual(Array.from(items, item => app.provider.description(item).left), [
    '官方字幕 · 中英双语 · SRT',
    'CMCT字幕组 · 中英双语 · SRT',
    '官方字幕 · F.I.X字幕侠 · 中英双语 · SRT',
  ]);
  assert.equal(app.provider.description(items[1]).right, '下载 1234 次');
  assert.equal(app.calls.length, 1, 'source labels must not require detail-page requests');
});

test('other or missing sources stay visible without labels inferred from release titles', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text:
    card({ id: 'Other', title: 'Kill.Bill.Vol.2.2004.官方字幕.CMCT字幕组' }) +
    card({ id: 'Original', source: '原创翻译' }) +
    card({ id: 'Missing', source: '' }),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(items.length, 3);
  for (const item of items) assert.equal(app.provider.description(item).left, '中英双语 · SRT');
});

test('group names are decoded and external links cannot masquerade as SubHD groups', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text:
    card({ id: 'Named', group: '<strong>YYeTs</strong>&amp;字幕组', groupURL: '/zu/14' }) +
    card({ id: 'External', group: '官方字幕', groupURL: 'https://evil.example/zu/14' }) +
    card({ id: 'Uploader', group: '字幕组上传者', groupURL: '/u/14' }),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(app.provider.description(items[0]).left, 'YYeTs&字幕组 · 中英双语 · SRT');
  assert.equal(app.provider.description(items[1]).left, '中英双语 · SRT');
  assert.equal(app.provider.description(items[2]).left, '中英双语 · SRT');
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

test('all search pages are collected, deduplicated and ranked together', async t => {
  const links = (...pages) => pages.map(page => `<a class="page-link" href="/search/Kill%20Bill%20Vol%202%202004/${page}">${page}</a>`).join('');
  const app = runtime({ get: url => ({ statusCode: 200, text: url.endsWith('/3')
    ? card({ id: 'Third', title: 'Kill.Bill.Vol.2.2004', source: '官方字幕' }) + links(2, 3)
    : url.endsWith('/2') ? card({ id: 'Second', title: 'Kill.Bill.Vol.2.2004', group: 'CMCT字幕组' }) + card({ id: 'First', title: 'Kill.Bill.Vol.1.2003' }) + links(1, 2, 3)
    : card({ id: 'First', title: 'Kill.Bill.Vol.1.2003' }) + links(1, 2),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.deepEqual(Array.from(items, item => item.data.detailPath), ['/a/Second', '/a/Third', '/a/First']);
  assert.equal(app.provider.description(items[1]).left, '官方字幕 · 中英双语 · SRT');
  assert.equal(app.calls.length, 3);
});

test('pagination continues past foreign-only pages and ignores unrelated or external links', async t => {
  const app = runtime({ get: url => ({ statusCode: 200, text: url.endsWith('/2') ? card() :
    card({ language: '西班牙语' }) +
    '<a class="page-link" href="https://evil.example/search/Kill%20Bill%20Vol%202%202004/2">2</a>' +
    '<a class="page-link" href="/search/Other/2">2</a>' +
    '<a class="page-link" href="/search/Kill%20Bill%20Vol%202%202004/1">1</a>' +
    '<a class="page-link" href="/search/Kill%20Bill%20Vol%202%202004/2">2</a>',
  }) });
  t.after(app.cleanup);
  assert.equal((await app.provider.search()).length, 1);
  assert.deepEqual(app.calls.map(call => call.url), [
    'https://subhd.tv/search/Kill%20Bill%20Vol%202%202004',
    'https://subhd.tv/search/Kill%20Bill%20Vol%202%202004/2',
  ]);
});

test('a later page failure retries the whole search at the configured mirror', async t => {
  const app = runtime({ preferences: { fallbackBaseURL: 'https://subhd.me' }, get: url => {
    if (url.startsWith('https://subhd.me')) return { statusCode: 200, text: card({ id: 'Mirror' }) };
    if (url.endsWith('/2')) return { statusCode: 503, text: '' };
    return { statusCode: 200, text: card() + '<a class="page-link" href="/search/Kill%20Bill%20Vol%202%202004/2">2</a>' };
  } });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.equal(items[0].data.detailPath, '/a/Mirror');
  assert.equal(app.calls.length, 3);
});

test('only explicit Chinese language metadata admits a row, regardless of its title or source', async t => {
  const app = runtime({ get: () => ({ statusCode: 200, text:
    card({ id: 'Spanish', language: '西班牙语', title: '中文字幕 Spanish.srt' }) +
    card({ id: 'English', language: 'English', title: '中文字幕 English.srt' }) +
    card({ id: 'OtherBilingual', language: '西班牙语 英语 双语', group: '中文字幕组' }) +
    card({ id: 'Unknown', language: '', source: '中文字幕' }) +
    card({ id: 'Missing', language: '英语' }).replace('text-truncate', 'missing-metadata') +
    card({ id: 'Simplified', language: '简体' }) +
    card({ id: 'Traditional', language: '繁體' }) +
    card({ id: 'Chinese', language: '中文' }) +
    card({ id: 'ChineseEnglish', language: 'Chinese English Bilingual' }) +
    card({ id: 'ChineseJapanese', language: '简体 日语 双语' }),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.deepEqual(Array.from(items, item => item.data.detailPath), [
    '/a/Simplified', '/a/Traditional', '/a/Chinese', '/a/ChineseEnglish', '/a/ChineseJapanese',
  ]);
  assert.deepEqual(Array.from(items, item => item.data.language), [
    '简体中文', '繁体中文', '中文字幕', '中英双语', '简体中文',
  ]);
});

test('numeric titles keep their title number while the final release year drives ranking', async t => {
  for (const [name, query] of [
    ['Blade.Runner.2049.2017.1080p.mkv', 'Blade Runner 2049'],
    ['Blade_Runner_2049_2017_1080p_WEB-DL.mkv', 'Blade Runner 2049'],
    ['Blade Runner 2049 (2017) 1080p.mkv', 'Blade Runner 2049'],
    ['2001.A.Space.Odyssey.1968.1080p.mkv', '2001 A Space Odyssey'],
    ['Wonder.Woman.1984.2020.1080p.mkv', 'Wonder Woman 1984'],
    ['Blade.Runner.2049.1080p.mkv', 'Blade Runner 2049'],
    ['Class.of.1999.1080p.mkv', 'Class of 1999'],
    ['1917.1080p.mkv', '1917'],
  ]) {
    const app = runtime({ status: { url: 'file:///tmp/' + name }, get: () => ({ statusCode: 200, text:
      card({ id: 'TitleNumber', title: 'Blade.Runner.2049.2049' }) +
      card({ id: 'ReleaseYear', title: 'Blade.Runner.2049.2017' }),
    }) });
    t.after(app.cleanup);
    const items = await app.provider.search();
    assert.equal(decodeURIComponent(app.calls[0].url.split('/search/')[1]), query, name);
    if (name.includes('2049.2017')) assert.equal(items[0].data.detailPath, '/a/ReleaseYear');
  }
});

test('a full numeric movie title ranks above a related film released in the same year', async t => {
  const app = runtime({ status: { url: 'file:///tmp/Blade.Runner.2049.2017.1080p.mkv' }, get: () => ({ statusCode: 200, text:
    card({ id: 'Short', title: 'Blade.Runner.Black.Out.2022.2017' }) +
    card({ id: 'Original', title: 'Blade.Runner.1982' }) +
    card({ id: 'Movie', title: 'Blade.Runner.2049.2017' }),
  }) });
  t.after(app.cleanup);
  const items = await app.provider.search();
  assert.deepEqual(Array.from(items, item => item.data.detailPath), ['/a/Movie', '/a/Short', '/a/Original']);
  assert.equal(decodeURIComponent(app.calls[0].url.split('/search/')[1]), 'Blade Runner 2049');
});

test('ambiguous release years fall back to the title after a precise search returns nothing', async t => {
  const app = runtime({ get: url => ({ statusCode: 200, text: url.endsWith('/Kill%20Bill%20Vol%202') ? card() : '' }) });
  t.after(app.cleanup);
  assert.equal((await app.provider.search()).length, 1);
  assert.deepEqual(app.calls.map(call => decodeURIComponent(call.url.split('/search/')[1])), ['Kill Bill Vol 2 2004', 'Kill Bill Vol 2']);
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

test('archive episode matching compares season and episode numbers across separators and padding', async t => {
  for (const [video, member] of [
    ['Show.S01.E02.1080p.mkv', 'Show.S01E02.chs.srt'],
    ['Show.S01E02.1080p.mkv', 'Show.S1-E2.chs.srt'],
    ['Show.S1 E2.1080p.mkv', 'Show.S01_E002.chs.srt'],
  ]) {
    const app = runtime({ status: { url: 'file:///tmp/' + encodeURIComponent(video) }, downloadURL: 'https://dl.subhd.me/episodes.zip' });
    t.after(app.cleanup);
    const source = path.join(app.root, 'episodes');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'Show.S01E01.chs.srt'), SRT.replace('中文字幕', '错误集数'));
    fs.writeFileSync(path.join(source, 'Show.S02E02.chs.srt'), SRT.replace('中文字幕', '错误季数'));
    fs.writeFileSync(path.join(source, member), SRT);
    const archive = path.join(app.root, 'episodes.zip');
    assert.equal((await nativeExec('/usr/bin/bsdtar', ['--format', 'zip', '-cf', archive, '-C', source, '.'])).status, 0);
    app.iina.http.download = async (_, dest) => fs.copyFileSync(archive, dest);
    const paths = await app.provider.download(item);
    assert.equal(fs.readFileSync(paths[0], 'utf8'), SRT, video + ' -> ' + member);
  }
});

test('an archive containing only another episode is still rejected', async t => {
  const app = runtime({ status: { url: 'file:///tmp/Show.S01.E02.1080p.mkv' }, downloadURL: 'https://dl.subhd.me/episodes.zip' });
  t.after(app.cleanup);
  const source = path.join(app.root, 'episodes');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'Show.S01E01.chs.srt'), SRT);
  const archive = path.join(app.root, 'episodes.zip');
  assert.equal((await nativeExec('/usr/bin/bsdtar', ['--format', 'zip', '-cf', archive, '-C', source, '.'])).status, 0);
  app.iina.http.download = async (_, dest) => fs.copyFileSync(archive, dest);
  await assert.rejects(app.provider.download(item), /没有可加载的中文字幕/);
});
