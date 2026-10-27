"""Model-facing schemas for the deliberately small Tongzhou tool surface."""

import json
from pathlib import Path

_MANIFEST = json.loads((Path(__file__).resolve().parents[2] / "tool-manifest.json").read_text(encoding="utf-8"))
READ_TOOLS = frozenset(item["name"] for item in _MANIFEST["tools"] if item["mode"] == "read")
WRITE_TOOLS = frozenset(item["name"] for item in _MANIFEST["tools"] if item["mode"] == "write")


def _object(properties, required=()):
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": list(required),
    }


def _string(description, enum=None, max_length=200, pattern=None, format_name=None):
    result = {"type": "string", "description": description, "minLength": 1, "maxLength": max_length}
    if enum:
        result["enum"] = list(enum)
    if pattern:
        result["pattern"] = pattern
    if format_name:
        result["format"] = format_name
    return result


TOOL_SCHEMAS = {
    "tongzhou_search_resources": {
        "name": "tongzhou_search_resources",
        "description": "Search business resources visible to the bound Tongzhou user. Use this to locate a resource before reading it.",
        "parameters": _object({
            "q": _string("SKU, name, order number, project, warehouse, or other search term.", max_length=500),
            "types": {"type": "array", "items": _string("Agent Index resource type.", max_length=64), "maxItems": 12, "uniqueItems": True},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        }, ("q",)),
    },
    "tongzhou_get_resource": {
        "name": "tongzhou_get_resource",
        "description": "Read one business resource visible to the bound Tongzhou user by type and identifier.",
        "parameters": _object({
            "type": _string("Agent Index resource type.", max_length=64, pattern=r"^[a-z][a-z0-9_]*$"),
            "id": _string("Business resource identifier.", max_length=200),
        }, ("type", "id")),
    },
    "tongzhou_query_exception_cases": {
        "name": "tongzhou_query_exception_cases",
        "description": "Query deterministic exception cases in the user's warehouse and SKU scope.",
        "parameters": _object({
            "status": _string("Case status.", ("open", "investigating", "action_pending", "resolved", "dismissed")),
            "severity": _string("Case severity.", ("critical", "high", "medium", "low")),
            "assigneeId": _string("Assigned business user identifier.", max_length=160),
            "ruleCode": _string("Deterministic patrol rule code.", max_length=100, pattern=r"^[a-z][a-z0-9_]*$"),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_inventory_risk": {
        "name": "tongzhou_query_inventory_risk",
        "description": "Query current stockout and replenishment risks from permission-filtered inventory projections.",
        "parameters": _object({
            "warehouseId": _string("Warehouse identifier.", max_length=160),
            "sku": _string("SKU.", max_length=120),
            "status": _string("Inventory risk status.", max_length=80),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_stockup_execution": {
        "name": "tongzhou_query_stockup_execution",
        "description": "Query stockup requests and execution tasks, including expected dates and current status.",
        "parameters": _object({
            "status": _string("Request or execution status.", max_length=80),
            "project": _string("Project name.", max_length=200),
            "warehouseId": _string("Destination warehouse identifier.", max_length=160),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_production_timeline": {
        "name": "tongzhou_query_production_timeline",
        "description": "Query production timelines, delivery dates, and material readiness in the user's scope.",
        "parameters": _object({
            "status": _string("Production status.", max_length=80),
            "project": _string("Project name.", max_length=200),
            "sku": _string("SKU.", max_length=120),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_partner_tasks": {
        "name": "tongzhou_query_partner_tasks",
        "description": "Query active or overdue partner collaboration tasks visible to the current internal user.",
        "parameters": _object({
            "status": _string("Partner task status.", max_length=80),
            "organization": _string("Partner organization name or code.", max_length=200),
            "itemType": _string("Partner task type.", max_length=80, pattern=r"^[a-z][a-z0-9_]*$"),
            "overdueOnly": {"type": "boolean"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_compare_movement_inventory": {
        "name": "tongzhou_compare_movement_inventory",
        "description": "Calculate sales-movement versus inventory differences for diagnosis using current Tongzhou data.",
        "parameters": _object({
            "period": _string("Comparison period.", ("day", "week", "month")),
            "warehouseId": _string("Warehouse identifier.", max_length=160),
            "sku": _string("Optional SKU.", max_length=120),
            "timezone": _string("IANA timezone; default Asia/Shanghai.", max_length=64, pattern=r"^[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*$"),
        }, ("period",)),
    },
    "tongzhou_create_stockup_draft": {
        "name": "tongzhou_create_stockup_draft",
        "description": "Create a stockup request draft only. This write pauses for one-time human approval before execution.",
        "parameters": _object({
            "project": _string("Project name.", max_length=200),
            "destinationCountry": _string("Destination country.", max_length=80),
            "destinationWarehouseId": _string("Destination warehouse identifier.", max_length=160),
            "destinationWarehouseName": _string("Destination warehouse display name.", max_length=200),
            "expectedArrivalAt": _string("Expected arrival date in ISO date format.", max_length=10, format_name="date"),
            "reason": _string("Evidence-backed reason for the draft.", max_length=1000),
            "lines": {
                "type": "array",
                "minItems": 1,
                "maxItems": 100,
                "items": _object({
                    "sku": _string("SKU.", max_length=120),
                    "productName": _string("Product name.", max_length=300),
                    "requestedQty": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000000000},
                    "unit": _string("Quantity unit.", max_length=32),
                }, ("sku", "requestedQty")),
            },
        }, ("destinationWarehouseId", "lines")),
    },
    "tongzhou_assign_exception": {
        "name": "tongzhou_assign_exception",
        "description": "Assign an exception case to a responsible person. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier.", max_length=160),
            "version": {"type": "integer", "minimum": 1},
            "assigneeId": _string("Target business user identifier.", max_length=160),
            "assigneeName": _string("Target user's display name.", max_length=120),
            "note": _string("Optional assignment note.", max_length=1000),
        }, ("caseId", "version", "assigneeId")),
    },
    "tongzhou_update_exception_status": {
        "name": "tongzhou_update_exception_status",
        "description": "Update exception handling status and resolution. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier.", max_length=160),
            "version": {"type": "integer", "minimum": 1},
            "status": _string("Target case status.", ("open", "investigating", "action_pending", "resolved", "dismissed")),
            "resolution": _string("Resolution or handling note.", max_length=2000),
        }, ("caseId", "version", "status")),
    },
    "tongzhou_send_exception_reminder": {
        "name": "tongzhou_send_exception_reminder",
        "description": "Send one exception reminder through the configured WeCom route. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier.", max_length=160),
            "version": {"type": "integer", "minimum": 1},
            "note": _string("Short evidence-backed reminder note.", max_length=1000),
        }, ("caseId", "version")),
    },
}

if set(TOOL_SCHEMAS) != READ_TOOLS | WRITE_TOOLS:
    raise RuntimeError("Tongzhou tool schemas do not match integrations/hermes/tool-manifest.json")
