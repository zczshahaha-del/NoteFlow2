"""Local operator console may inspect the engine; curation goes through NoteFlow."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if not (self.path.startswith('/v1/default/') or self.path in ('/health', '/openapi.json')):
            self.send_error(404)
            return
        try:
            with urlopen(Request('http://127.0.0.1:8888' + self.path), timeout=30) as response:
                payload = response.read()
                self.send_response(response.status)
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as exc:
            self.send_error(exc.code)
        except URLError:
            self.send_error(503)

    def blocked(self):
        self.send_response(403)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"detail":"Use NoteFlow memory settings for changes; this operator console is read-only."}')

    do_POST = do_PATCH = do_PUT = do_DELETE = blocked


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8890), Handler).serve_forever()
