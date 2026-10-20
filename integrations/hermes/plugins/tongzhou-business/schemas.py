"""Model-facing schemas for the deliberately small Tongzhou tool surface."""

READ_TOOLS = frozenset({
    "tongzhou_search_resources",
    "tongzhou_get_resource",
    "tongzhou_query_exception_cases",
    "tongzhou_query_inventory_risk",
    "tongzhou_query_stockup_execution",
    "tongzhou_query_production_timeline",
    "tongzhou_compare_movement_inventory",
    "tongzhou_query_risk_batch",
})

WRITE_TOOLS = frozenset({
    "tongzhou_create_stockup_draft",
    "tongzhou_assign_exception",
    "tongzhou_update_exception_status",
    "tongzhou_send_exception_reminder",
})


def _object(properties, required=()):
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": list(required),
    }


def _string(description, enum=None):
    result = {"type": "string", "description": description}
    if enum:
        result["enum"] = list(enum)
    return result


TOOL_SCHEMAS = {
    "tongzhou_search_resources": {
        "name": "tongzhou_search_resources",
        "description": "Search business resources visible to the bound Tongzhou user. Use this to locate a resource before reading it.",
        "parameters": _object({
            "q": _string("SKU, name, order number, project, warehouse, or other search term."),
            "types": {"type": "array", "items": {"type": "string"}, "maxItems": 12},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        }, ("q",)),
    },
    "tongzhou_get_resource": {
        "name": "tongzhou_get_resource",
        "description": "Read one business resource visible to the bound Tongzhou user by type and identifier.",
        "parameters": _object({
            "type": _string("Agent Index resource type."),
            "id": _string("Business resource identifier."),
        }, ("type", "id")),
    },
    "tongzhou_query_exception_cases": {
        "name": "tongzhou_query_exception_cases",
        "description": "Query deterministic exception cases in the user's warehouse and SKU scope.",
        "parameters": _object({
            "status": _string("Case status.", ("open", "investigating", "action_pending", "resolved", "dismissed")),
            "severity": _string("Case severity.", ("critical", "high", "medium", "low")),
            "assigneeId": _string("Assigned business user identifier."),
            "ruleCode": _string("Deterministic patrol rule code."),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_inventory_risk": {
        "name": "tongzhou_query_inventory_risk",
        "description": "Query current stockout and replenishment risks from permission-filtered inventory projections.",
        "parameters": _object({
            "warehouseId": _string("Warehouse identifier."),
            "sku": _string("SKU."),
            "status": _string("Inventory risk status."),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_stockup_execution": {
        "name": "tongzhou_query_stockup_execution",
        "description": "Query stockup requests and execution tasks, including expected dates and current status.",
        "parameters": _object({
            "status": _string("Request or execution status."),
            "project": _string("Project name."),
            "warehouseId": _string("Destination warehouse identifier."),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_query_production_timeline": {
        "name": "tongzhou_query_production_timeline",
        "description": "Query production timelines, delivery dates, and material readiness in the user's scope.",
        "parameters": _object({
            "status": _string("Production status."),
            "project": _string("Project name."),
            "sku": _string("SKU."),
            "limit": {"type": "integer", "minimum": 1, "maximum": 200},
        }),
    },
    "tongzhou_compare_movement_inventory": {
        "name": "tongzhou_compare_movement_inventory",
        "description": "Calculate sales-movement versus inventory differences for diagnosis using current Tongzhou data.",
        "parameters": _object({
            "period": _string("Comparison period.", ("day", "week", "month")),
            "warehouseId": _string("Warehouse identifier."),
            "sku": _string("Optional SKU."),
            "timezone": _string("IANA timezone; default Asia/Shanghai."),
        }, ("period",)),
    },
    "tongzhou_query_risk_batch": {
        "name": "tongzhou_query_risk_batch",
        "description": "Batch-query inventory, stockup, and production risks in one permission-scoped call. Prefer this for broad diagnosis instead of one query per SKU.",
        "parameters": _object({
            "warehouseId": _string("Optional warehouse identifier."),
            "project": _string("Optional project name."),
            "sku": _string("Optional SKU."),
            "status": _string("Optional status filter."),
            "limitPerDomain": {"type": "integer", "minimum": 1, "maximum": 100},
        }),
    },
    "tongzhou_create_stockup_draft": {
        "name": "tongzhou_create_stockup_draft",
        "description": "Create a stockup request draft only. This write pauses for one-time human approval before execution.",
        "parameters": _object({
            "project": _string("Project name."),
            "destinationCountry": _string("Destination country."),
            "destinationWarehouseId": _string("Destination warehouse identifier."),
            "destinationWarehouseName": _string("Destination warehouse display name."),
            "expectedArrivalAt": _string("Expected arrival date in ISO date format."),
            "reason": _string("Evidence-backed reason for the draft."),
            "lines": {
                "type": "array",
                "minItems": 1,
                "maxItems": 100,
                "items": _object({
                    "sku": _string("SKU."),
                    "productName": _string("Product name."),
                    "requestedQty": {"type": "number", "exclusiveMinimum": 0},
                    "unit": _string("Quantity unit."),
                }, ("sku", "requestedQty")),
            },
        }, ("destinationWarehouseId", "lines")),
    },
    "tongzhou_assign_exception": {
        "name": "tongzhou_assign_exception",
        "description": "Assign an exception case to a responsible person. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier."),
            "version": {"type": "integer", "minimum": 1},
            "assigneeId": _string("Target business user identifier."),
            "assigneeName": _string("Target user's display name."),
            "note": _string("Optional assignment note."),
        }, ("caseId", "version", "assigneeId")),
    },
    "tongzhou_update_exception_status": {
        "name": "tongzhou_update_exception_status",
        "description": "Update exception handling status and resolution. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier."),
            "version": {"type": "integer", "minimum": 1},
            "status": _string("Target case status.", ("open", "investigating", "action_pending", "resolved", "dismissed")),
            "resolution": _string("Resolution or handling note."),
        }, ("caseId", "version", "status")),
    },
    "tongzhou_send_exception_reminder": {
        "name": "tongzhou_send_exception_reminder",
        "description": "Send one exception reminder through the configured WeCom route. This write pauses for one-time human approval.",
        "parameters": _object({
            "caseId": _string("Exception case identifier."),
            "version": {"type": "integer", "minimum": 1},
            "note": _string("Short evidence-backed reminder note."),
        }, ("caseId", "version")),
    },
}
