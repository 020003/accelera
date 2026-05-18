"""OpenAPI 3.1 specification + Swagger UI for the Accelera public API.

Routes
------
    GET /api/v1/openapi.json   — machine-readable spec
    GET /api/v1/docs           — interactive Swagger UI (CDN-loaded)

The spec is generated from a Python dict so it stays version-pinned to
this codebase (no decorator-based reflection); when you add a new
endpoint to ``api_v1.py``, also add its schema here.
"""

from __future__ import annotations

from flask import Blueprint, Response, jsonify

openapi_bp = Blueprint("openapi", __name__)

API_VERSION = "1.0.0"
SWAGGER_UI_VERSION = "5.17.14"


def _spec() -> dict:
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Accelera Public API",
            "version": API_VERSION,
            "description": (
                "Bearer-token authenticated REST API for the Accelera GPU "
                "fleet monitoring platform.\n\n"
                "**Authentication.** Mint a token in the dashboard at "
                "*Settings → API Tokens* and pass it as "
                "`Authorization: Bearer acc_<token>` on every request.\n\n"
                "**Rate limit.** Shared per-IP bucket of 120 req/min by "
                "default (configurable via `RATE_LIMIT_PER_MIN`). Exceeded "
                "requests get `429`.\n\n"
                "**Errors.** Every error body is JSON: `{\"error\": \"...\"}`."
            ),
            "contact": {"name": "Accelera", "url": "https://github.com/020003/accelera"},
            "license": {"name": "AGPL-3.0", "url": "https://www.gnu.org/licenses/agpl-3.0.html"},
        },
        "servers": [
            {"url": "/", "description": "Same origin as the dashboard"},
        ],
        "tags": [
            {"name": "meta",   "description": "Service metadata"},
            {"name": "fleet",  "description": "Live fleet snapshots & token usage"},
            {"name": "costs",  "description": "Cloud-model pricing & cost equivalence"},
        ],
        "security": [{"bearerAuth": []}],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "acc_<32hex>",
                    "description": (
                        "Personal access token minted at "
                        "**Settings → API Tokens**. Format: `acc_` + 32 hex "
                        "chars (38 chars total). Tokens are bcrypt-hashed "
                        "at rest and shown exactly once at creation."
                    ),
                }
            },
            "schemas": {
                "Error": {
                    "type": "object",
                    "required": ["error"],
                    "properties": {"error": {"type": "string"}},
                },
                "Host": {
                    "type": "object",
                    "required": ["url", "name"],
                    "properties": {
                        "url":        {"type": "string", "example": "http://10.2.3.31:5000/nvidia-smi.json"},
                        "name":       {"type": "string", "example": "Server 1"},
                        "created_at": {"type": "string", "example": "2026-04-18T09:12:33Z"},
                    },
                },
                "GpuSnapshot": {
                    "type": "object",
                    "properties": {
                        "index":            {"type": "integer", "example": 0},
                        "name":             {"type": "string",  "example": "NVIDIA H100 80GB"},
                        "uuid":             {"type": "string"},
                        "utilization_pct":  {"type": "number", "nullable": True, "example": 87.0},
                        "memory_used_mib":  {"type": "integer", "nullable": True, "example": 51200},
                        "memory_total_mib": {"type": "integer", "nullable": True, "example": 81920},
                        "temperature_c":    {"type": "number",  "nullable": True, "example": 68.0},
                        "power_w":          {"type": "number",  "nullable": True, "example": 412.3},
                    },
                },
                "HostSummary": {
                    "type": "object",
                    "properties": {
                        "url":             {"type": "string"},
                        "name":            {"type": "string"},
                        "connected":       {"type": "boolean"},
                        "error":           {"type": "string", "nullable": True},
                        "timestamp":       {"type": "string", "nullable": True},
                        "driver_version":  {"type": "string", "nullable": True},
                        "cuda_version":    {"type": "string", "nullable": True},
                        "gpus": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/GpuSnapshot"},
                        },
                    },
                },
                "FleetTotals": {
                    "type": "object",
                    "properties": {
                        "gpu_count":        {"type": "integer", "example": 32},
                        "power_w":          {"type": "number",  "example": 8417.5},
                        "memory_used_mib":  {"type": "integer"},
                        "memory_total_mib": {"type": "integer"},
                        "connected":        {"type": "integer", "example": 4},
                    },
                },
                "FleetSummary": {
                    "type": "object",
                    "properties": {
                        "fetched_at": {"type": "number", "format": "unix-timestamp"},
                        "hosts": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/HostSummary"},
                        },
                        "totals": {"$ref": "#/components/schemas/FleetTotals"},
                    },
                },
                "HostTokens": {
                    "type": "object",
                    "properties": {
                        "url":                  {"type": "string"},
                        "name":                 {"type": "string"},
                        "connected":            {"type": "boolean"},
                        "prompt_tokens":        {"type": "integer"},
                        "completion_tokens":    {"type": "integer"},
                        "cumulative_prompt":    {"type": "integer"},
                        "cumulative_generated": {"type": "integer"},
                        "by_model":             {"type": "array", "items": {"type": "object"}},
                    },
                },
                "FleetTokens": {
                    "type": "object",
                    "properties": {
                        "hours": {"type": "integer", "example": 24},
                        "hosts": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/HostTokens"},
                        },
                        "totals": {
                            "type": "object",
                            "properties": {
                                "prompt_tokens":        {"type": "integer"},
                                "completion_tokens":    {"type": "integer"},
                                "total_tokens":         {"type": "integer"},
                                "cumulative_prompt":    {"type": "integer"},
                                "cumulative_generated": {"type": "integer"},
                            },
                        },
                    },
                },
                "CatalogModel": {
                    "type": "object",
                    "properties": {
                        "id":                  {"type": "string", "example": "anthropic/claude-opus-4"},
                        "name":                {"type": "string", "example": "Claude Opus 4"},
                        "provider":            {"type": "string", "example": "anthropic"},
                        "prompt_per_mtok":     {"type": "number", "example": 15.0},
                        "completion_per_mtok": {"type": "number", "example": 75.0},
                        "context":             {"type": "integer", "nullable": True, "example": 200000},
                        "description":         {"type": "string",  "nullable": True},
                    },
                },
                "CostCatalog": {
                    "type": "object",
                    "properties": {
                        "models":     {"type": "array", "items": {"$ref": "#/components/schemas/CatalogModel"}},
                        "fetched_at": {"type": "number"},
                        "source":     {"type": "string", "example": "openrouter"},
                        "ttl_sec":    {"type": "integer", "example": 21600},
                        "count":      {"type": "integer"},
                    },
                },
                "CostRow": {
                    "allOf": [
                        {"$ref": "#/components/schemas/CatalogModel"},
                        {
                            "type": "object",
                            "properties": {
                                "cost_prompt_usd":     {"type": "number"},
                                "cost_completion_usd": {"type": "number"},
                                "cost_total_usd":      {"type": "number"},
                            },
                        },
                    ],
                },
                "CostCalculation": {
                    "type": "object",
                    "properties": {
                        "prompt_tokens":     {"type": "integer"},
                        "completion_tokens": {"type": "integer"},
                        "source":            {"type": "string"},
                        "fetched_at":        {"type": "number"},
                        "models": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/CostRow"},
                            "description": "Ranked ascending by cost_total_usd",
                        },
                    },
                },
                "Whoami": {
                    "type": "object",
                    "properties": {
                        "token_id":   {"type": "string"},
                        "name":       {"type": "string"},
                        "prefix":     {"type": "string", "example": "acc_a1b2c3d4"},
                        "scopes":     {"type": "string", "enum": ["read", "read:write"]},
                        "created_by": {"type": "string"},
                        "expires_at": {"type": "number", "nullable": True},
                    },
                },
            },
            "responses": {
                "Unauthorized": {
                    "description": "Missing or invalid bearer token",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                },
                "Forbidden": {
                    "description": "Token lacks required scope",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                },
                "BadRequest": {
                    "description": "Invalid query/body parameters",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                },
                "RateLimited": {
                    "description": "Per-IP rate limit exceeded",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}},
                },
            },
        },
        "paths": {
            "/api/v1": {
                "get": {
                    "tags": ["meta"], "summary": "API index",
                    "security": [],
                    "responses": {"200": {"description": "Index of available routes",
                                          "content": {"application/json": {"schema": {"type": "object"}}}}},
                },
            },
            "/api/v1/whoami": {
                "get": {
                    "tags": ["meta"], "summary": "Token metadata",
                    "responses": {
                        "200": {"description": "Token info",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Whoami"}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
            "/api/v1/hosts": {
                "get": {
                    "tags": ["fleet"], "summary": "List configured fleet members",
                    "description": "Returns hosts in user-defined order (drag-and-drop in Settings).",
                    "responses": {
                        "200": {
                            "description": "Host list",
                            "content": {"application/json": {"schema": {
                                "type": "object",
                                "properties": {"hosts": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/Host"},
                                }},
                            }}},
                        },
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
            "/api/v1/fleet/summary": {
                "get": {
                    "tags": ["fleet"], "summary": "Live GPU snapshot across the fleet",
                    "description": (
                        "Parallel fan-out (8 workers) to every exporter's "
                        "`/nvidia-smi.json`.  Returns per-host detail plus "
                        "fleet-wide totals.  Failed hosts are included with "
                        "`connected: false`."
                    ),
                    "responses": {
                        "200": {"description": "Fleet snapshot",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/FleetSummary"}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "429": {"$ref": "#/components/responses/RateLimited"},
                    },
                },
            },
            "/api/v1/fleet/tokens": {
                "get": {
                    "tags": ["fleet"], "summary": "Aggregated LLM token usage",
                    "parameters": [{
                        "name": "hours", "in": "query",
                        "schema": {"type": "integer", "minimum": 1, "maximum": 720, "default": 24},
                        "description": "Rolling window in hours (capped at 720 = 30 days).",
                    }],
                    "responses": {
                        "200": {"description": "Token totals",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/FleetTokens"}}}},
                        "400": {"$ref": "#/components/responses/BadRequest"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
            "/api/v1/costs/models": {
                "get": {
                    "tags": ["costs"], "summary": "Cloud-model pricing catalog",
                    "description": (
                        "OpenRouter-backed catalog of ~330 cloud LLMs with "
                        "USD/Mtok prices.  Cached server-side for 6 h."
                    ),
                    "parameters": [{
                        "name": "refresh", "in": "query",
                        "schema": {"type": "string", "enum": ["1", "true", "yes"]},
                        "description": "Force an upstream re-pull (bounded by cache TTL).",
                    }],
                    "responses": {
                        "200": {"description": "Pricing catalog",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CostCatalog"}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
            "/api/v1/costs/calculate": {
                "get": {
                    "tags": ["costs"], "summary": "Cost per cloud model for given token counts",
                    "description": (
                        'Given prompt + completion token totals, returns '
                        'per-model USD cost ranked ascending.  Pair with '
                        '`/fleet/tokens` to ask "what would last week\'s '
                        'tokens have cost on every commercial API?".'
                    ),
                    "parameters": [
                        {"name": "prompt_tokens",     "in": "query", "required": True,
                         "schema": {"type": "integer", "minimum": 0}},
                        {"name": "completion_tokens", "in": "query", "required": True,
                         "schema": {"type": "integer", "minimum": 0}},
                    ],
                    "responses": {
                        "200": {"description": "Cost ranking",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CostCalculation"}}}},
                        "400": {"$ref": "#/components/responses/BadRequest"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
        },
    }


@openapi_bp.route("/api/v1/openapi.json", methods=["GET"])
def openapi_json():
    """OpenAPI 3.1 spec.  Unauthenticated so docs tooling can consume it."""
    return jsonify(_spec())


_SWAGGER_HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accelera API — Swagger UI</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@{SWAGGER_UI_VERSION}/swagger-ui.css">
  <style>
    body {{ margin: 0; background: #fafafa; }}
    .topbar {{ display: none; }}
    .swagger-ui .info {{ margin: 32px 0 16px; }}
    .swagger-ui .info .title {{ font-size: 28px; }}
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@{SWAGGER_UI_VERSION}/swagger-ui-bundle.js"
          crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@{SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js"
          crossorigin="anonymous"></script>
  <script>
    window.onload = () => {{
      window.ui = SwaggerUIBundle({{
        url: "/api/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        persistAuthorization: true,
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 0,
      }});
    }};
  </script>
</body>
</html>
"""


@openapi_bp.route("/api/v1/docs", methods=["GET"])
@openapi_bp.route("/api/v1/docs/", methods=["GET"])
def swagger_ui():
    """Swagger UI page.  Loads CSS/JS from jsDelivr (CSP-friendly via SRI
    would be a follow-up).  Token can be entered via the Authorize button."""
    # Tight CSP scoped to jsDelivr + same-origin XHR.  Inline script is the
    # tiny bootstrap above, allowed via 'unsafe-inline'.
    csp = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "style-src  'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "img-src    'self' data:; "
        "connect-src 'self';"
    )
    resp = Response(_SWAGGER_HTML, mimetype="text/html; charset=utf-8")
    resp.headers["Content-Security-Policy"] = csp
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp
