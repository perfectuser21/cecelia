from api.brain.ping import bp as brain_ping_bp


def register_routes(app):
    app.register_blueprint(brain_ping_bp)
