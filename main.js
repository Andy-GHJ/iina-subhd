/* global iina */

(function () {
  "use strict";

  var PROVIDER_ID = "subhd-cn";
  var DEFAULT_SITE = "https://subhd.tv";
  var DEFAULT_FALLBACK_SITE = "https://subhd.me";
  var SUPPORTED_EXTENSIONS = ["srt", "ass", "ssa", "vtt"];
  var ALLOWED_HOSTS = {
    "subhd.tv": true,
    "www.subhd.tv": true,
    "subhd.me": true,
    "www.subhd.me": true,
    "subhdtw.com": true,
    "www.subhdtw.com": true,
    "subhd.one": true,
    "www.subhd.one": true,
    "subhd.top": true,
    "www.subhd.top": true,
    "subhd.cc": true,
    "www.subhd.cc": true,
  };

  var http = iina.http;
  var subtitle = iina.subtitle;
  var file = iina.file;
  var preferences = iina.preferences;
  var console = iina.console;
  var utils = iina.utils;
  var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, function (_, number) {
        return String.fromCharCode(parseInt(number, 10));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, number) {
        return String.fromCharCode(parseInt(number, 16));
      });
  }

  function stripTags(value) {
    return decodeEntities(String(value || "").replace(/<[^>]*>/g, " "))
      .replace(/[\t\r\n ]+/g, " ")
      .trim();
  }

  function getAttribute(tag, name) {
    var escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var expression = new RegExp(
      "\\b" + escapedName + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i"
    );
    var match = expression.exec(tag);
    return match ? decodeEntities(match[1] || match[2] || match[3] || "") : "";
  }

  function findClosingDiv(source, contentStart) {
    var tagExpression = /<\/?div\b[^>]*>/gi;
    var depth = 1;
    tagExpression.lastIndex = contentStart;

    var match;
    while ((match = tagExpression.exec(source))) {
      if (/^<\s*\/div/i.test(match[0])) {
        depth -= 1;
        if (depth === 0) {
          return match.index;
        }
      } else {
        depth += 1;
      }
    }
    return source.length;
  }

  function sitePath(path) {
    var text = String(path || "");
    if (/^https?:\/\//i.test(text)) {
      var absoluteMatch = /^https?:\/\/([^/]+)(\/[^#]*)?/i.exec(text);
      if (!absoluteMatch || !ALLOWED_HOSTS[absoluteMatch[1].toLowerCase()]) {
        throw new Error("SubHD 返回了不受支持的字幕链接");
      }
      return absoluteMatch[2] || "/";
    }
    return text.charAt(0) === "/" ? text : "/" + text;
  }

  function absoluteURL(baseURL, path) {
    return baseURL + sitePath(path);
  }

  function normalizeSite(value) {
    var text = String(value || "").trim();
    if (!text) {
      return "";
    }
    if (!/^https?:\/\//i.test(text)) {
      text = "https://" + text;
    }
    text = text.replace(/\/+$/, "");

    var match = /^https:\/\/([^/:?#]+)$/i.exec(text);
    if (!match) {
      return "";
    }
    var host = match[1].toLowerCase();
    if (!ALLOWED_HOSTS[host]) {
      return "";
    }
    return "https://" + host;
  }

  function configuredSites() {
    var sites = [];
    var savedPrimary = normalizeSite(preferences.get("baseURL"));
    var fallbackValue = preferences.get("fallbackBaseURL");
    var savedFallback = normalizeSite(fallbackValue);
    var primary = savedPrimary || DEFAULT_SITE;
    var fallback = fallbackValue === "" ? "" : savedFallback || DEFAULT_FALLBACK_SITE;

    sites.push(primary);
    if (fallback && fallback !== primary) {
      sites.push(fallback);
    }
    return sites;
  }

  function looksBlocked(html) {
    // Normal pages include cloudflare-static/email-decode.min.js. Only match
    // actual challenge markup or a challenge page title, not vendor names.
    return /(?:<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied|人机验证|安全验证)|<(?:form|div)\b[^>]*\bid\s*=\s*["'](?:challenge-form|challenge-running|cf-challenge-running|cf-chl-widget)["'])/i.test(String(html || ""));
  }

  function fetchSearchPage(site, query) {
    var url = site + "/search/" + encodeURIComponent(query);
    return http.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: site + "/",
      },
    }).then(function (response) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error("SubHD 返回 HTTP " + response.statusCode);
      }
      if (looksBlocked(response.text)) {
        throw new Error("SubHD 要求验证或拦截了自动请求");
      }
      return {
        site: site,
        html: response.text || "",
      };
    });
  }

  function extractResults(html, site) {
    var results = [];
    var cardExpression = /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmb-4\b)[^>]*>/gi;
    var cardMatch;

    while ((cardMatch = cardExpression.exec(html))) {
      var contentStart = cardExpression.lastIndex;
      var cardEnd = findClosingDiv(html, contentStart);
      var card = html.slice(contentStart, cardEnd);
      cardExpression.lastIndex = cardEnd + 6;

      var titleBlockMatch = /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bview-text\b)[^>]*>([\s\S]*?)<\/div>/i.exec(
        card
      ) || /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bf12\b[^"']*\bpt-1\b)[^>]*>([\s\S]*?)<\/div>/i.exec(
        card
      );
      var titleBlock = titleBlockMatch ? titleBlockMatch[1] : card;
      var anchorExpression = /<a\b[^>]*>/gi;
      var anchorMatch;
      var title = "";
      var link = "";

      while ((anchorMatch = anchorExpression.exec(titleBlock))) {
        var href = getAttribute(anchorMatch[0], "href");
        if (/^\/a\//i.test(href) || /^https?:\/\/[^/]+\/a\//i.test(href)) {
          title = getAttribute(anchorMatch[0], "title");
          if (!title) {
            var anchorEnd = titleBlock.indexOf("</a", anchorExpression.lastIndex);
            title = stripTags(
              titleBlock.slice(anchorExpression.lastIndex, anchorEnd < 0 ? undefined : anchorEnd)
            );
          }
          link = href;
          break;
        }
      }

      if (!link || !title) {
        continue;
      }

      var cardText = stripTags(card);
      if (/(?:英文|英语|English)/i.test(cardText) && !/(?:简体|繁体|中文|中英|双语|简繁|Chinese)/i.test(cardText)) {
        continue;
      }

      var language = "中文字幕";
      if (/(?:双语|中英|简英|繁英)/i.test(cardText)) {
        language = "中英双语";
      } else if (/(?:繁体|繁中|繁體)/i.test(cardText)) {
        language = "繁体中文";
      } else if (/(?:简体|简中|簡體)/i.test(cardText)) {
        language = "简体中文";
      }

      var extensions = [];
      SUPPORTED_EXTENSIONS.forEach(function (extension) {
        var expression = new RegExp("(?:^|[\\s,./])" + extension + "(?:$|[\\s,./])", "i");
        if (expression.test(cardText)) {
          extensions.push(extension.toUpperCase());
        }
      });

      var countMatch = /(\d[\d,]*)\s*次/.exec(cardText);
      if (!countMatch) {
        countMatch = /\bbi-download\b[\s\S]*?<\/svg>\s*<span\b[^>]*>\s*(\d[\d,]*)/i.exec(card);
      }
      var downloads = countMatch ? parseInt(countMatch[1].replace(/,/g, ""), 10) : null;

      results.push({
        title: title,
        detailURL: absoluteURL(site, link),
        detailPath: sitePath(link),
        site: site,
        language: language,
        formats: extensions,
        downloads: downloads,
        source: extractSource(card),
      });
    }

    return results;
  }

  function extractSource(card) {
    var sources = [];
    // Source badges belong to the metadata row; a release title mentioning
    // "official" is not evidence that SubHD marked it as an official subtitle.
    var metadata = /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\btext-truncate\b)[^>]*>([\s\S]*?)<\/div>/i.exec(card);
    if (metadata) {
      var badges = /<span\b(?=[^>]*\bclass\s*=\s*["'][^"']*\brounded\b)[^>]*>([\s\S]*?)<\/span>/gi;
      var badge;
      while ((badge = badges.exec(metadata[1]))) {
        if (stripTags(badge[1]) === "官方字幕") sources.push("官方字幕");
      }
    }

    // SubHD can show a /zu/<id> group even when its source badge says "other".
    var anchors = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    var anchor;
    while ((anchor = anchors.exec(card))) {
      var href = getAttribute(anchor[0].slice(0, anchor[0].indexOf(">") + 1), "href");
      try {
        if (!/^\/zu\/\d+\/?(?:[?#].*)?$/.test(sitePath(href))) continue;
      } catch (_) { continue; }
      var group = stripTags(anchor[1].replace(/<[^>]*>/g, ""));
      if (group && sources.indexOf(group) === -1) sources.push(group);
    }
    return sources.join(" · ");
  }

  function cleanQuery(name) {
    return String(name || "")
      .replace(/\.(?:mkv|mp4|avi|mov|m4v|wmv|flv|ts|m2ts|webm)$/i, "")
      .replace(/\b(?:2160p|1080p|720p|576p|480p|4k|8k|blu[ ._-]?ray|bdrip|brrip|web[ ._-]?dl|web[ ._-]?rip|hdtv|hdrip|remux|x264|x265|h[ ._-]?264|h[ ._-]?265|hevc|av1|aac|dts|truehd|ddp?\d?(?:\.\d)?|proper|repack)\b/gi, " ")
      .replace(/[._]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function searchQueries(title) {
    var queries = [];
    function add(value) {
      value = value.trim();
      if (value && !queries.some(function (query) { return query.toLowerCase() === value.toLowerCase(); })) {
        queries.push(value);
      }
    }
    // Release names often leave a year, audio channels or uploader after
    // cleaning. Search the movie/episode name before these release details.
    var stem = title.replace(/\.(?:mkv|mp4|avi|mov|m4v|wmv|flv|ts|m2ts|webm)$/i, "");
    var boundary = /(?:[ ._\[(\-]+(?:19\d{2}|20\d{2}|2160p|1080p|720p|480p|blu[ ._-]?ray|web[ ._-]?dl|b[dr]rip)\b)/i.exec(stem);
    var episode = /\bS\d{1,2}[ ._-]*E\d{1,3}\b/i.exec(stem);
    if (episode) {
      add(cleanQuery(stem.slice(0, episode.index + episode[0].length)));
    } else if (boundary && boundary.index > 0) {
      add(cleanQuery(stem.slice(0, boundary.index)));
    }
    add(cleanQuery(stem));
    add(stem);
    return queries;
  }

  function resultScore(record, title) {
    var year = /\b(?:19|20)\d{2}\b/.exec(title);
    var score = year && record.title.indexOf(year[0]) !== -1 ? 10 : 0;
    var part = /\b(?:vol(?:ume)?|part)[ ._-]*(\d+)\b/i.exec(title);
    var resultPart = /\b(?:vol(?:ume)?|part)[ ._-]*(\d+)\b/i.exec(record.title);
    if (part && resultPart) {
      score += part[1] === resultPart[1] ? 20 : -20;
    }
    return score;
  }

  function decodePathPart(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function getVideoSearchName() {
    var status = iina.core.status || {};
    var url = String(status.url || "");
    var title = String(status.title || "").trim();
    var path = url.replace(/[?#].*$/, "");
    var isLocal = /^file:\/\//i.test(path);
    if (isLocal) {
      path = path.replace(/^file:\/\//i, "");
    }
    var filename = path.split("/").pop() || "";
    filename = decodePathPart(filename);
    filename = filename.replace(/\.(?:mkv|mp4|avi|mov|m4v|wmv|flv|ts|m2ts|webm)$/i, "");

    var chosen = isLocal ? filename : title || filename;
    if (!chosen) {
      chosen = title;
    }
    return chosen.trim();
  }

  function scoreFilename(filename, extension) {
    var score = extension === "srt" ? 2 : extension === "ass" ? 1 : 0;
    if (/(?:中英|双语|bilingual|zh[._ -]?en|chs[._ -]?en)/i.test(filename)) {
      score += 12;
    } else if (/(?:简体|简中|chs|zh[._ -]?(?:cn|hans)|chinese)/i.test(filename)) {
      score += 10;
    } else if (/(?:繁体|繁中|cht|zh[._ -]?(?:tw|hant))/i.test(filename)) {
      score += 8;
    }
    if (/(?:^|[._ -])en(?:g)?(?:[._ -]|$)/i.test(filename) && !/(?:中英|双语|bilingual|chs|cht|zh[._ -]|简|繁|chinese)/i.test(filename)) {
      score -= 20;
    }
    return score;
  }

  function safeFilename(value) {
    return String(value || "subtitle")
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "subtitle";
  }

  function errorMessage(error) {
    if (error && error.message) return error.message;
    if (error && error.statusCode) return "HTTP " + error.statusCode + " " + (error.reason || "");
    return String(error);
  }

  function execute(binary, args, label) {
    return utils.exec(binary, args).then(function (result) {
      if (!result || result.status !== 0) {
        throw new Error(label + "失败：" + (result && result.stderr ? result.stderr.trim().slice(0, 240) : "命令执行失败"));
      }
      return result;
    });
  }

  function sessionRequest(session, path, output, json, referer) {
    // IINA 1.5's http.post only supports a form dictionary, not a raw JSON
    // body. Use system curl with an isolated anonymous cookie jar, matching
    // SubHD's detail -> prepare -> download-page -> download API sequence.
    var args = ["--silent", "--show-error", "--fail", "--connect-timeout", "10",
      "--max-time", "30", "--proto", "=https", "--user-agent", USER_AGENT,
      "--cookie", session.jar, "--cookie-jar", session.jar,
      "--output", session.root + "/" + output];
    if (referer) args.push("--referer", absoluteURL(session.site, referer));
    if (json) {
      args.push("--header", "Content-Type: application/json", "--header", "Origin: " + session.site,
        "--data", JSON.stringify(json));
    }
    args.push("--", absoluteURL(session.site, path));
    return execute("/usr/bin/curl", args, "SubHD 请求").then(function () {
      var text = file.read(session.root + "/" + output, {});
      if (looksBlocked(text)) throw new Error("SubHD 要求人机验证，请在浏览器打开字幕详情页完成验证后重试。");
      return text;
    });
  }

  function jsonResponse(text) {
    try {
      var data = JSON.parse(text);
      if (data && typeof data === "object") return data;
    } catch (_) { /* report an actionable error below */ }
    throw new Error("SubHD 下载接口没有返回有效 JSON");
  }

  function subtitleID(html, path) {
    var button = /<button\b[^>]*\bdata-sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i.exec(html);
    var match = /^\/a\/([a-z0-9]+)$/i.exec(sitePath(path));
    var sid = button ? button[1] || button[2] || button[3] : match && match[1];
    if (!sid || !/^[a-z0-9]+$/i.test(sid)) throw new Error("SubHD 详情页没有有效的字幕 ID");
    return sid;
  }

  function validateDownloadURL(value) {
    var match = /^https:\/\/([^/:?#]+)(\/[^?#]*)(?:\?[^#]*)?$/i.exec(String(value || ""));
    if (!match || (!ALLOWED_HOSTS[match[1].toLowerCase()] &&
        !/^dl\.(?:subhd\.(?:tv|me|one|top|cc)|subhdtw\.com)$/i.test(match[1]))) {
      throw new Error("SubHD 返回了不受支持的下载域名");
    }
    var extension = /\.([a-z0-9]+)$/i.exec(match[2]);
    extension = extension ? extension[1].toLowerCase() : "";
    if (SUPPORTED_EXTENSIONS.concat(["zip", "rar", "7z"]).indexOf(extension) === -1) {
      throw new Error("SubHD 返回了不受支持的字幕文件格式");
    }
    return { url: value, extension: extension };
  }

  function validateSubtitle(path, extension) {
    var handle = file.handle(path, "read");
    if (!handle) throw new Error("无法读取下载的字幕文件");
    var bytes;
    try { bytes = handle.read(16384); } finally { handle.close(); }
    if (!bytes || !bytes.length) throw new Error("下载的字幕文件为空");
    var text = "";
    var step = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 254 && bytes[1] === 255 ? 2 : 1;
    for (var index = step === 2 ? 2 : 0; index < bytes.length; index += step) {
      var code = step === 1 ? bytes[index] : bytes[0] === 255
        ? bytes[index] + bytes[index + 1] * 256 : bytes[index] * 256 + bytes[index + 1];
      text += String.fromCharCode(code);
    }
    var valid = extension === "srt" ? /\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(text)
      : extension === "vtt" ? /WEBVTT/.test(text)
      : /\[(?:Script Info|Events)\]/i.test(text);
    if (!valid || /<(?:!doctype|html|body)\b/i.test(text)) {
      throw new Error("下载内容不是有效的 " + extension.toUpperCase() + " 字幕（可能是站点验证页）");
    }
  }

  function unpackSubtitle(session, path, extension, title) {
    if (SUPPORTED_EXTENSIONS.indexOf(extension) !== -1) {
      validateSubtitle(path, extension);
      return Promise.resolve([path]);
    }
    return execute("/usr/bin/bsdtar", ["-tf", path], "读取字幕压缩包").then(function (result) {
      var candidates = result.stdout.split(/\r?\n/).filter(function (name) {
        // Read a selected member to stdout; never extract archive paths to disk.
        return name && !/(?:^|\/)__MACOSX(?:\/|$)/.test(name) &&
          !/(?:^|\/)\._/.test(name) && !/[\r\n\x00]/.test(name) &&
          /\.(?:srt|ass|ssa|vtt)$/i.test(name);
      }).map(function (name) {
        var ext = /\.([a-z]+)$/i.exec(name)[1].toLowerCase();
        var score = scoreFilename(name, ext) + resultScore({ title: name }, title);
        var episode = /S\d{1,2}[ ._-]*E\d{1,3}/i.exec(title);
        if (episode) score += name.toLowerCase().indexOf(episode[0].toLowerCase()) !== -1 ? 40 : -40;
        return { name: name, extension: ext, score: score };
      }).sort(function (left, right) { return right.score - left.score; });
      if (!candidates.length) throw new Error("压缩包中没有 SRT、ASS、SSA 或 VTT 字幕");
      function tryFile(index, lastError) {
        if (index >= Math.min(candidates.length, 8)) throw lastError || new Error("压缩包中没有可加载的中文字幕");
        var candidate = candidates[index];
        if (candidate.score < -10) return tryFile(index + 1, lastError);
        var target = session.root + "/" + safeFilename(candidate.name) + "." + candidate.extension;
        // bsdtar treats member arguments as patterns. Escape metacharacters,
        // including brackets common in Chinese filenames. Shell code is
        // constant; all paths are passed as positional arguments.
        var pattern = candidate.name.replace(/[\\*?\[\]]/g, "\\$&");
        return execute("/bin/sh", ["-c", 'ulimit -f 65536; exec /usr/bin/bsdtar -xOf "$1" -- "$2" > "$3"',
          "subhd-extract", path, pattern, target], "解压字幕").then(function () {
          validateSubtitle(target, candidate.extension);
          return [target];
        }).catch(function (error) { return tryFile(index + 1, error); });
      }
      return tryFile(0, null);
    });
  }

  function downloadAtSite(site, data) {
    var root = utils.resolvePath("@tmp/subhd-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10));
    if (!root) return Promise.reject(new Error("IINA 无法提供插件临时目录"));
    var session = { site: site, root: root, jar: root + "/cookies.txt" };
    var sid;
    var downPath;
    function cleanup() {
      ["cookies.txt", "prepare.json", "download.json", "detail.html", "down.html"].forEach(function (name) {
        var path = root + "/" + name;
        if (file.exists(path)) file.delete(path);
      });
    }
    return execute("/bin/mkdir", ["-m", "700", root], "创建字幕临时目录").then(function () {
      return sessionRequest(session, data.detailPath, "detail.html");
    }).then(function (html) {
      sid = subtitleID(html, data.detailPath);
      return sessionRequest(session, "/api/sub/prepare-download", "prepare.json", { sid: sid }, data.detailPath);
    }).then(function (text) {
      var response = jsonResponse(text);
      if (response.success !== true || !/^\/down\/[a-z0-9]+$/i.test(response.url || "")) {
        throw new Error(response.msg || "SubHD 无法准备字幕下载");
      }
      downPath = response.url;
      return sessionRequest(session, downPath, "down.html", null, data.detailPath);
    }).then(function () {
      return sessionRequest(session, "/api/sub/down", "download.json", { sid: sid }, downPath);
    }).then(function (text) {
      var response = jsonResponse(text);
      if (response.success !== true || response.pass !== true) {
        throw new Error(response.msg || "SubHD 下载验证未通过，请在浏览器中打开字幕详情页查看。");
      }
      var download = validateDownloadURL(response.url);
      var path = root + "/subhd-" + sid + "." + download.extension;
      return http.download(download.url, path, { headers: { "User-Agent": USER_AGENT } }).then(function () {
        return unpackSubtitle(session, path, download.extension, getVideoSearchName());
      });
    }).then(function (paths) {
      cleanup();
      return paths;
    }, function (error) {
      cleanup();
      throw error;
    });
  }

  async function downloadSubtitle(item) {
    var data = item.data;
    var sites = configuredSites();
    var source = normalizeSite(data.site);
    if (source) sites = [source].concat(sites.filter(function (site) { return site !== source; }));
    var errors = [];
    function trySite(index) {
      return downloadAtSite(sites[index], data).catch(function (error) {
        errors.push(sites[index] + "：" + errorMessage(error));
        console.warn(errors[errors.length - 1]);
        if (index + 1 < sites.length) return trySite(index + 1);
        throw new Error("SubHD 完整字幕下载失败。" + errors.join("；"));
      });
    }
    return trySite(0);
  }

  async function search() {
    var title = getVideoSearchName();
    if (!title) {
      throw new Error("IINA 没有提供当前影片标题或文件名，无法搜索 SubHD。");
    }

    var queries = searchQueries(title);

    var sites = configuredSites();
    var errors = [];

    function searchSite(siteIndex) {
      if (siteIndex >= sites.length) {
        var details = errors.length ? errors[errors.length - 1] : "未知错误";
        throw new Error("SubHD 无法访问。请检查网络或插件偏好设置中的备用站点。" + details);
      }

      var site = sites[siteIndex];
      function tryQuery(queryIndex) {
        if (queryIndex >= queries.length) {
          return [];
        }
        return fetchSearchPage(site, queries[queryIndex]).then(function (page) {
          var records = extractResults(page.html, page.site);
          if (records.length) {
            records.sort(function (left, right) { return resultScore(right, title) - resultScore(left, title); });
            return records.map(function (record) {
              return subtitle.item(record);
            });
          }
          if (queryIndex + 1 < queries.length) {
            return tryQuery(queryIndex + 1);
          }
          return [];
        });
      }

      return tryQuery(0).then(
        function (items) {
          if (items.length || siteIndex + 1 >= sites.length) {
            return items;
          }
          return searchSite(siteIndex + 1);
        },
        function (error) {
          errors.push(site + "：" + errorMessage(error));
          console.warn(errors[errors.length - 1]);
          if (siteIndex + 1 < sites.length) {
            return searchSite(siteIndex + 1);
          }
          throw new Error(
            "SubHD 无法访问。请检查网络或插件偏好设置中的备用站点。" +
              errors[errors.length - 1]
          );
        }
      );
    }

    return searchSite(0);
  }

  subtitle.registerProvider(PROVIDER_ID, {
    search: search,
    description: function (item) {
      var data = item.data || {};
      var format = data.formats && data.formats.length ? data.formats.join(" / ") : "字幕文件";
      var downloads = data.downloads === null || data.downloads === undefined
        ? "SubHD"
        : "下载 " + data.downloads + " 次";
      return {
        name: data.title || "SubHD 字幕",
        left: (data.source ? data.source + " · " : "") + data.language + " · " + format,
        right: downloads,
      };
    },
    download: downloadSubtitle,
  });

  console.log("SubHD 中文字幕提供方已注册");
})();
