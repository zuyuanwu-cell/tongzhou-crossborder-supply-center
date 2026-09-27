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
access_token = string_value(
    agentConf.get("accessToken")
    or agentConf.get("_widget_17905017360991")
)
if not access_token:
    raise ValueError("请先在插件通用参数中配置中台入库令牌")

source_record_id = string_value(triggerConf.get("sourceRecordId"))
warehouse = string_value(triggerConf.get("warehouse"))
sku = "".join(string_value(triggerConf.get("sku")).split()).upper()
product_name = string_value(triggerConf.get("productName"))
quantity = number_value(triggerConf.get("quantity"))

if not source_record_id:
    raise ValueError("缺少简道云来源单据 ID，无法防止重复入库")
if not warehouse:
    raise ValueError("请选择或填写启用中的国内仓库编码或名称")
if not sku:
    raise ValueError("缺少同舟 SKU")
if not product_name:
    raise ValueError("缺少产品名称")
if quantity is None or quantity <= 0:
    raise ValueError("入库数量必须大于 0")

payload = {
    "warehouse": warehouse,
    "sourceRecordId": source_record_id,
    "sourceLineId": string_value(triggerConf.get("sourceLineId")),
    "sourceType": string_value(triggerConf.get("sourceType")) or "简道云委外入库",
    "receiptBatch": string_value(triggerConf.get("receiptBatch")),
    "referenceNo": string_value(triggerConf.get("referenceNo")),
    "operatorName": string_value(triggerConf.get("operatorName")),
    "note": string_value(triggerConf.get("note")),
    "sku": sku,
    "productName": product_name,
    "unit": string_value(triggerConf.get("unit")) or "件",
    "quantity": quantity,
    "unitCostCny": number_value(triggerConf.get("unitCostCny")),
    "lotNo": string_value(triggerConf.get("lotNo")),
    "barcode": string_value(triggerConf.get("barcode")),
    "productionDate": string_value(triggerConf.get("productionDate"))[:10],
    "expiryDate": string_value(triggerConf.get("expiryDate"))[:10],
    "dryRun": yes_value(triggerConf.get("dryRun")),
}

try:
    response = requests.post(
        api_base_url + "/api/integrations/jiandaoyun/domestic-inventory/inbound",
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
        raise ValueError("中台入库失败（%s）：%s" % (code, message))

    return {
        "success": bool(body.get("ok")),
        "message": string_value(body.get("message")) or "入库完成",
        "dryRun": bool(body.get("dryRun")),
        "movementNo": string_value(body.get("movementNo")),
        "warehouseName": string_value(body.get("warehouseName")),
        "sku": string_value(body.get("sku")) or sku,
        "quantity": body.get("quantity") or quantity,
        "idempotentReplay": bool(body.get("idempotentReplay")),
    }
except ValueError:
    raise
except Exception as error:
    raise ValueError("中台入库请求失败：%s" % str(error))
