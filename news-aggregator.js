// News Aggregator — Multi-source RSS polling with deduplication
(function (global) {
  'use strict';

 var RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json?count=15&rss_url=';
 var RAW_RSS_PROXIES = [
   'https://api.allorigins.win/raw?url=',
   'https://api.allorigins.workers.dev/raw?url='
 ];
 
  // Free RSS feeds — fetched via rss2json CORS proxy
  var FEEDS = [
    {
      name: 'Yahoo Finance',
      url:  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=EURUSD%3DX%2CGC%3DF%2CBTC-USD&region=US&lang=en-US',
    },
    {
      name: 'FXStreet',
      url:  'https://www.fxstreet.com/rss/news',
    },
    {
      name: 'Investing.com Forex',
      url:  'https://www.investing.com/rss/news_14.rss',
    },
    {
      name: 'Reuters Business',
      url:  'https://feeds.reuters.com/reuters/businessNews',
    },
  ];

  var REDDIT_FEEDS = [
    { name: 'Reddit Crypto', url: 'https://www.reddit.com/r/CryptoCurrency/new.json?limit=15' },
    { name: 'Reddit Forex',  url: 'https://www.reddit.com/r/Forex/new.json?limit=15' },
    { name: 'Reddit Markets', url: 'https://www.reddit.com/r/investing/new.json?limit=15' },
  ];

  // Normalised titles we have already scored to prevent duplicate signals
  var seenSet    = new Set();
  var allHistory = []; // last 100 headlines ever fetched (deduped)

  // Jaccard similarity threshold above which two headlines are treated as duplicates.
  // 0.6 means 60% word overlap — chosen to catch rephrased versions of the same story
  // without over-filtering genuinely distinct headlines on the same topic.
  var DUPLICATE_THRESHOLD = 0.6;

  // Seen-set size limits: trim to RETAINED_SEEN_SIZE entries once MAX_SEEN_SIZE is reached.
  var MAX_SEEN_SIZE      = 500;
  var RETAINED_SEEN_SIZE = 200;
  var REQUEST_TIMEOUT_MS = 12000;
  var RSS_PROXY_TIMEOUT_MS = 7000;
  var RAW_PROXY_TIMEOUT_MS = 10000;

  function fetchWithTimeout(url, options, timeoutMs) {
    var timeout = timeoutMs || REQUEST_TIMEOUT_MS;
    if (window.AbortController) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeout);
      var requestOptions = options || {};
      requestOptions.signal = controller.signal;
      return fetch(url, requestOptions).then(function (res) {
        clearTimeout(timer);
        return res;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      });
    }
    return Promise.race([
      fetch(url, options),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Request timeout')); }, timeout);
      }),
    ]);
  }

  function isAbortLikeError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    var msg = String(err && (err.message || err) || '').toLowerCase();
    return msg.indexOf('aborted') >= 0 || msg.indexOf('timeout') >= 0;
  }

  function logFetchIssue(prefix, feedName, err) {
    if (isAbortLikeError(err)) {
      console.warn(prefix + ' timeout:', feedName);
      return;
    }
    console.warn(prefix + ' failed:', feedName, err);
  }

  // ── Text normalisation ───────────────────────────────────────────────────────
  function normalise(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Jaccard word-set similarity (0–1) ────────────────────────────────────────
  function jaccard(a, b) {
    var wordsA = a.split(' ');
    var wordsB = b.split(' ');
    var setA   = {};
    var setB   = {};
    wordsA.forEach(function (w) { setA[w] = true; });
    wordsB.forEach(function (w) { setB[w] = true; });
    var inter = 0;
    Object.keys(setA).forEach(function (w) { if (setB[w]) inter++; });
    var unionSize = Object.keys(setA).length + Object.keys(setB).length - inter;
    return unionSize ? inter / unionSize : 0;
  }

  function isDuplicate(title) {
    var n = normalise(title);
    var seen = Array.from(seenSet);
    for (var i = 0; i < seen.length; i++) {
      if (jaccard(n, seen[i]) > DUPLICATE_THRESHOLD) return true;
    }
    return false;
  }

  function mapItemsFromRss2Json(feed, data) {
    if (!data || !data.items || !data.items.length) return [];
    return data.items.slice(0, 12).map(function (item) {
      return {
        title:   (item.title   || '').trim(),
        link:    item.link     || '',
        pubDate: item.pubDate  || '',
        author:  item.author   || feed.name,
        source:  feed.name,
        ts:      item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
      };
    });
  }

  function parseRssXml(feed, xmlText) {
    if (!xmlText) return [];
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    var parserError = doc.querySelector('parsererror');
    if (parserError) return [];
    var nodes = Array.prototype.slice.call(doc.querySelectorAll('item, entry'));
    return nodes.slice(0, 12).map(function (node) {
      var titleNode = node.querySelector('title');
      var linkNode = node.querySelector('link');
      var pubNode = node.querySelector('pubDate, published, updated');
      var authorNode = node.querySelector('author name, author');

      var link = '';
      if (linkNode) {
        link = linkNode.getAttribute('href') || linkNode.textContent || '';
      }

      var pubDate = pubNode ? (pubNode.textContent || '').trim() : '';
      var ts = pubDate ? new Date(pubDate).getTime() : Date.now();
      if (!isFinite(ts)) ts = Date.now();

      return {
        title:   titleNode ? (titleNode.textContent || '').trim() : '',
        link:    String(link || '').trim(),
        pubDate: pubDate,
        author:  authorNode ? (authorNode.textContent || '').trim() : feed.name,
        source:  feed.name,
        ts:      ts,
      };
    }).filter(function (item) {
      return !!item.title;
    });
  }

  function fetchFeedViaRawRss(feed) {
    var encoded = encodeURIComponent(feed.url);
    function tryProxy(index) {
      if (index >= RAW_RSS_PROXIES.length) return Promise.resolve([]);
      var url = RAW_RSS_PROXIES[index] + encoded;
      return fetchWithTimeout(url, { cache: 'no-store' }, RAW_PROXY_TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) {
            console.warn('Raw RSS HTTP error:', feed.name, res.status, res.statusText);
            return '';
          }
          return res.text();
        })
        .then(function (xmlText) {
          var rows = parseRssXml(feed, xmlText);
          if (rows.length) return rows;
          return tryProxy(index + 1);
        })
        .catch(function (err) {
          logFetchIssue('Raw RSS', feed.name, err);
          return tryProxy(index + 1);
        });
    }
    return tryProxy(0);
  }

  function fetchRedditFeed(feed) {
    return fetchWithTimeout(feed.url, { cache: 'no-store' }, REQUEST_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) {
          console.warn('Reddit feed HTTP error:', feed.name, res.status, res.statusText);
          return null;
        }
        return res.json();
      })
      .then(function (json) {
        var children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
        return children.slice(0, 12).map(function (row) {
          var d = row && row.data ? row.data : {};
          var created = Number(d.created_utc || 0) * 1000;
          var link = d.permalink ? ('https://www.reddit.com' + d.permalink) : '';
          return {
            title: String(d.title || '').trim(),
            link: link,
            pubDate: created ? new Date(created).toUTCString() : '',
            author: String(d.author || feed.name),
            source: feed.name,
            ts: created || Date.now(),
          };
        }).filter(function (item) { return !!item.title; });
      })
      .catch(function (err) {
        logFetchIssue('Reddit feed', feed.name, err);
        return [];
      });
  }

  function fetchRedditFallbackNews() {
    return Promise.all(REDDIT_FEEDS.map(fetchRedditFeed)).then(function (results) {
      var flat = [];
      results.forEach(function (r) { if (r) flat = flat.concat(r); });
      flat.sort(function (a, b) { return b.ts - a.ts; });
      return flat;
    });
  }

  // ── Fetch a single RSS feed through rss2json ─────────────────────────────────
  function fetchFeed(feed) {
    var url = RSS2JSON_BASE + encodeURIComponent(feed.url);
    return fetchWithTimeout(url, { cache: 'no-store' }, RSS_PROXY_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) {
          console.warn('News feed HTTP error:', feed.name, res.status, res.statusText);
          return [];
        }
        return res.json();
      })
      .then(function (data) {
        var rows = mapItemsFromRss2Json(feed, data);
        if (rows.length) return rows;
        console.warn('News feed returned no items via rss2json:', feed.name);
        return fetchFeedViaRawRss(feed);
      })
      .catch(function (err) {
        logFetchIssue('News feed', feed.name, err);
        return fetchFeedViaRawRss(feed);
      });
  }

  // ── Fetch all feeds, deduplicate, return fresh + full history ────────────────
  function fetchAllNews() {
    var startedAt = Date.now();
    return Promise.all(FEEDS.map(fetchFeed)).then(function (results) {
      // Flatten and sort by recency
      var flat = [];
      results.forEach(function (r) { if (r) flat = flat.concat(r); });
      flat.sort(function (a, b) { return b.ts - a.ts; });

      if (!flat.length) {
        return fetchRedditFallbackNews();
      }

      return flat;
    }).then(function (flat) {

      var freshHeadlines = [];
      flat.forEach(function (h) {
        if (!h.title) return;
        if (!isDuplicate(h.title)) {
          seenSet.add(normalise(h.title));
          freshHeadlines.push(h);
        }
      });

      // Prevent unbounded growth of seen-set
      if (seenSet.size > MAX_SEEN_SIZE) {
        var arr = Array.from(seenSet);
        seenSet = new Set(arr.slice(arr.length - RETAINED_SEEN_SIZE));
      }

      // Prepend fresh headlines to history, capped at 100
      allHistory = freshHeadlines.concat(allHistory).slice(0, 100);

      return {
        ok: true,
        elapsedMs: Date.now() - startedAt,
        fresh: freshHeadlines,
        all: allHistory,
      };
    }).catch(function (err) {
      logFetchIssue('News aggregation', 'all-feeds', err);
      return {
        ok: false,
        elapsedMs: Date.now() - startedAt,
        fresh: [],
        all: allHistory,
      };
    });
  }

  function getAll() { return allHistory; }

  // ── Public API ───────────────────────────────────────────────────────────────
  global.NewsAggregator = {
    fetchAllNews: fetchAllNews,
    getAll:       getAll,
  };

}(window));
