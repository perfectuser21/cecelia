from flask import Flask

from api.routes import register_routes
from core import runtime as _runtime


def create_app() -> Flask:
    _runtime.get_started_at()
    app = Flask(__name__)
    register_routes(app)
    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=5221)
