#!/usr/bin/env python3
"""Small JSON client for GeoPanel; credentials come only from environment or files."""

import argparse
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("method", choices=["GET", "POST", "PUT", "PATCH", "DELETE"])
    parser.add_argument("path", help="API path beginning /api/v1/")
    parser.add_argument("--body", type=Path, help="JSON request file")
    args = parser.parse_args()

    base = os.environ.get("GEOPANEL_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    parsed = urlsplit(base)
    local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme not in ("http", "https") or (parsed.scheme == "http" and not local):
        parser.error("Use HTTPS for remote servers; HTTP is allowed only on loopback.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("Base URL must not contain credentials, query, or fragment.")
    if not args.path.startswith("/api/v1/") or urlsplit(args.path).netloc:
        parser.error("Use an API path beginning /api/v1/.")

    token = os.environ.get("GEOPANEL_TOKEN", "").strip()
    if not token and os.environ.get("GEOPANEL_TOKEN_FILE"):
        token = Path(os.environ["GEOPANEL_TOKEN_FILE"]).read_text().strip()
    if not token:
        parser.error("Set GEOPANEL_TOKEN or GEOPANEL_TOKEN_FILE.")

    body = json.dumps(json.loads(args.body.read_text())).encode() if args.body else None
    request = Request(
        base + args.path,
        data=body,
        method=args.method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    handlers = [NoRedirect()]
    if local:
        handlers.append(ProxyHandler({}))

    try:
        with build_opener(*handlers).open(request, timeout=60) as response:
            result = json.load(response) if response.status != 204 else None
            print(json.dumps(result, ensure_ascii=False, indent=2))
    except HTTPError as error:
        message = error.read().decode().replace(token, "[redacted]")
        print(json.dumps({"status": error.code, "error": message}), file=sys.stderr)
        return 1
    except URLError as error:
        message = str(error.reason).replace(token, "[redacted]")
        print(json.dumps({"error": message}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
