"""简道云私有插件后端函数（Python 3.10）。"""

import json
import requests


def first_value(value):
    current = value
    if isinstance(current, str):
        current = current.strip()
        if ((current.startswith("[") and current.endswith("]")) or
                (current.startswith("{") and current.endswith("}"))):
            try:
                current = json.loads(current)
            except Exception:
                pass
    if isinstance(current, list):
        current = current[0] if current else None
    if isinstance(current, dict):
        if "value" in current:
            return current.get("value")
        if "name" in current:
            return current.get("name")
    return current


def string_value(value):
    current = first_value(value)
    return "" if current is None else str(current).strip()


def number_value(value):
    raw = string_value(value).replace(",", "")
    if not raw:
        return None
    try:
        return float(raw)
    except Exception:
        return None


def yes_value(value):
    return string_value(value).lower() in ("1", "true", "yes", "y", "是", "开启", "校验")


api_base_url = string_value(agentConf.get("apiBaseUrl") or "https://gyl.tongzhoukuajing.com").rstrip("/")
access_token = string_value(agentConf.get("accessToken"))
if not access_token:
    raise ValueError("请先在插件通用参数中配置中台出库令牌")

source_record_id = string_value(triggerConf.get("sourceRecordId"))
warehouse = string_value(triggerConf.get("warehouse"))
sku = "".join(string_value(triggerConf.get("sku")).split()).upper()
quantity = number_value(triggerConf.get("quantity"))

if not source_record_id:
    raise ValueError("缺少简道云数据 ID，无法防止重复出库")
if not warehouse:
    raise ValueError("请选择或填写启用中的国内仓库编码")
if not sku:
    raise ValueError("缺少同舟 SKU")
if quantity is None or quantity <= 0:
    raise ValueError("出库数量必须大于 0")

payload = {
    "warehouse": warehouse,
    "sourceRecordId": source_record_id,
    "sourceLineId": string_value(triggerConf.get("sourceLineId")),
    "sourceType": string_value(triggerConf.get("sourceType")) or "简道云出库单",
    "dispatchBatch": string_value(triggerConf.get("dispatchBatch")),
    "referenceNo": string_value(triggerConf.get("referenceNo")),
    "occurredAt": string_value(triggerConf.get("occurredAt")),
    "operatorName": string_value(triggerConf.get("operatorName")),
    "note": string_value(triggerConf.get("note")),
    "productId": string_value(triggerConf.get("productId")),
    "sku": sku,
    "productName": string_value(triggerConf.get("productName")),
    "imageUrl": string_value(triggerConf.get("imageUrl")),
    "specification": string_value(triggerConf.get("specification")),
    "unit": string_value(triggerConf.get("unit")) or "件",
    "quantity": quantity,
    "lotId": string_value(triggerConf.get("lotId")),
    "lotNo": string_value(triggerConf.get("lotNo")),
    "barcode": string_value(triggerConf.get("barcode")),
    "dryRun": yes_value(triggerConf.get("dryRun")),
}

try:
    response = requests.post(
        api_base_url + "/api/integrations/jiandaoyun/domestic-inventory/outbound",
        json=payload,
        headers={
            "Authorization": "Bearer " + access_token,
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    try:
        body = response.json()
    except Exception:
        body = {}
    if response.status_code >= 400:
        code = string_value(body.get("code")) or "http_%s" % response.status_code
        message = string_value(body.get("message")) or "中台接口请求失败"
        raise ValueError("中台出库失败（%s）：%s" % (code, message))

    return {
        "success": bool(body.get("ok")),
        "message": string_value(body.get("message")) or "出库完成",
        "dryRun": bool(body.get("dryRun")),
        "movementNo": string_value(body.get("movementNo")),
        "warehouseName": string_value(body.get("warehouseName")),
        "sku": string_value(body.get("sku")) or sku,
        "productName": string_value(body.get("productName")),
        "unit": string_value(body.get("unit")) or payload["unit"],
        "quantity": body.get("quantity") or quantity,
        "beforeQty": body.get("beforeQty") or 0,
        "afterQty": body.get("afterQty") or 0,
        "idempotentReplay": bool(body.get("idempotentReplay")),
    }
except ValueError:
    raise
except Exception as error:
    raise ValueError("中台出库请求失败：%s" % str(error))

