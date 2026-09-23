"""
serve.py - Unified launcher for NER Smart Logistics.

Serves the Flask backend API + frontend in a single server.
Injects app.js into index.html at serve-time so we never
modify the original index.html file.

Usage:
    python backend/serve.py

Then open http://localhost:5000 in your browser.
"""

import os
import sys

# Ensure the backend directory is on the path so we can import app
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

sys.path.insert(0, BACKEND_DIR)

# Import the Flask app from the existing app.py (no changes to app.py)
from app import app
from flask import redirect, send_from_directory, session


# ==========================================
# SERVE FRONTEND FILES
# ==========================================

def serve_index():
    """
    Read the original index.html, inject app.js script
    before map.js, and return the modified HTML.
    No file on disk is changed.
    """
    if "user_id" not in session:
        return send_from_directory(FRONTEND_DIR, "auth.html")

    index_path = os.path.join(FRONTEND_DIR, "index.html")

    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Inject app.js BEFORE map.js so all globals are
    # available when map.js (findRoute) executes.
    if '<script src="app.js"></script>' not in html:
        injection = '    <script src="app.js"></script>\n    '
        html = html.replace(
            '<script src="map.js"></script>',
            injection + '<script src="map.js"></script>'
        )

    return html


# Override the existing "/" route's view function from app.py.
# The URL rule "/" already exists (registered in app.py as "home"),
# so we just swap the view function it points to.
app.view_functions["home"] = serve_index


@app.route("/<path:filename>")
def serve_static(filename):
    """Serve CSS, JS, and other frontend assets."""
    if filename.endswith(".html") and filename != "auth.html" and "user_id" not in session:
        return redirect("/")
    return send_from_directory(FRONTEND_DIR, filename)


# ==========================================
# MAIN
# ==========================================

if __name__ == "__main__":
    print()
    print("=" * 56)
    print("  NER Smart Logistics - Unified Server")
    print("=" * 56)
    print("  Frontend : " + FRONTEND_DIR)
    print("  Backend  : " + BACKEND_DIR)
    print("  URL      : http://localhost:5000")
    print("=" * 56)
    print()

    app.run(debug=True, port=5000)
