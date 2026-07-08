#!/usr/bin/env python3
"""Ping IndexNow so Bing / Yandex / Seznam / Naver recrawl changed URLs immediately.

IndexNow is a crawl protocol, not a tracker, so it is compatible with Cubby's
no-third-party-tracker promise. It does not affect Google (Google uses the sitemap
<lastmod> + Search Console). This is the "constantly updated" half of seamless SEO:
run it right after a deploy so new/changed pages are discovered in minutes, not weeks.

Usage:
  python3 tools/indexnow_ping.py --changed        # URLs from git-changed public pages
                                                  #   (vs origin/main, else last commit)
  python3 tools/indexnow_ping.py --all            # every URL in sitemap.xml
  python3 tools/indexnow_ping.py URL [URL ...]    # explicit URLs
  add --dry-run to print the payload without sending.

The key is read from the 32-hex .txt file at the repo root (hosted at that same path),
so nothing secret lives here.
"""
import os, re, sys, json, glob, subprocess, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
HOST = "little-cubby.com"
BASE = "https://" + HOST
ENDPOINT = "https://api.indexnow.org/indexnow"
# Same non-public dirs the SEO guard skips — never ask engines to crawl these.
SKIP = ("node_modules/", "articles-drafts/", "tools/", "mockups/", "test/",
        "social/", "art-src/", "docs/", "app/", "g/")


def find_key():
    for f in glob.glob("*.txt"):
        name = f[:-4]
        if re.fullmatch(r"[0-9a-f]{8,}", name):
            body = open(f, encoding="utf-8").read().strip()
            if body == name:
                return name
    return None


def file_to_url(path):
    path = path.replace("\\", "/")
    if any(s in ("/" + path) for s in SKIP):
        return None
    if path == "index.html":
        return BASE + "/"
    if path.endswith("/index.html"):
        return BASE + "/" + path[:-len("index.html")]
    return None


def changed_urls():
    base = "origin/main"
    if subprocess.run(["git", "rev-parse", "--verify", base],
                      capture_output=True).returncode != 0:
        base = "HEAD~1"
    diff = subprocess.run(["git", "diff", "--name-only", base + "...HEAD"],
                          capture_output=True, text=True).stdout.split()
    # include working-tree changes too, so a post-deploy run catches the just-committed set
    diff += subprocess.run(["git", "diff", "--name-only", "HEAD"],
                           capture_output=True, text=True).stdout.split()
    urls = {file_to_url(f) for f in diff if f.endswith(".html")}
    return sorted(u for u in urls if u)


def sitemap_urls():
    if not os.path.exists("sitemap.xml"):
        return []
    sm = open("sitemap.xml", encoding="utf-8").read()
    return sorted(set(re.findall(r'<loc>([^<]+)</loc>', sm)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    if "--all" in flags:
        urls = sitemap_urls()
    elif "--changed" in flags:
        urls = changed_urls()
    elif args:
        urls = args
    else:
        print("nothing to do: pass --changed, --all, or explicit URLs")
        return

    if not urls:
        print("IndexNow: no changed public pages to submit.")
        return

    key = find_key()
    if not key:
        print("IndexNow: no key .txt file at repo root; skipping.")
        return

    payload = {"host": HOST, "key": key,
               "keyLocation": f"{BASE}/{key}.txt", "urlList": urls[:10000]}

    if "--dry-run" in flags:
        print(json.dumps(payload, indent=2))
        return

    req = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"IndexNow: submitted {len(urls)} URL(s) -> HTTP {r.status}")
    except Exception as e:
        # Non-fatal: IndexNow is best-effort; a failed ping must never break a deploy.
        print(f"IndexNow: submit failed ({e}) — non-fatal, engines will still recrawl via sitemap.")


if __name__ == "__main__":
    main()
