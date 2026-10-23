#!/usr/bin/env node
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";

const REQUEST_ID = "spr_b75b7061-0125-4ecf-86b2-9b42fbff54df";
const REQUEST_NO = "BR-20261020-AKUR0";
const WORK_ORDER_ID = "swwo_3c24baef-182e-4472-96a4-b5cb821cce39";
const WAREHOUSE_ID = "dwh_26f90786-e6a8-4653-b88b-3faea8c759f6";

const LOT_IDWG011 = "sil_e4f3a170-548e-45ad-a3a7-29b471a6267c";
const LOT_IDWG010 = "sil_1851bfda-a19b-4ce3-8d9c-63f16de7ebdf";
const LOT_IDWG035 = "sil_eb363e63-941b-4be3-b716-108c9c3b1d39";
const LOT_IDWG039_TAIL = "sil_94eddd0e-d33e-48c0-85d6-7d1abb1a8024";

const INV_LOT_IDWG011 = "dlot_e48003fd-9d70-4dc2-9109-c95daf97e067";
const INV_LOT_IDWG010 = "dlot_569832c0-7a21-4fe4-b1aa-b1d8c7701af6";
const INV_LOT_IDWG035 = "dlot_e69b459a-7cb6-4d5c-98ae-6a3fe15cef6f";
const INV_LOT_IDWG039_TAIL = "dlot_ed83222b-b72e-4996-b195-dc8a6e88cf43";

const LINE_IDWG011 = "swwl_3b92ed4b-512d-426e-ad12-c21217b76048";
const LINE_IDWG010 = "swwl_a4e51582-7658-4b99-8a12-642893c915d1";
const LINE_IDWG035 = "swwl_0f06a944-269d-4cec-874e-5255dc1bfab4";
const LINE_IDWG039 = "swwl_1825b955-169e-4800-a3d3-72c9820f66e7";
const REQUEST_LINE_IDWG039 = "srl_b1df532d-c0b5-4252-89d4-570881b34f7d";

const EVENT_ID = "spe_reconcile_br20261020_20261022";
const ADJUSTMENT_ID = "dim_reconcile_br20261020_20261022";
const ADJUSTMENT_LINE_ID = "dml_reconcile_br20261020_20261022";
const ALLOCATION_ID = "dla_reconcile_br20261020_20261022";
const ADJUSTMENT_NO = "TZ-20261022-AKUR0-01";

function argument(name) {
  const position = process.argv.indexOf(name);
  return position >= 0 ? process.argv[position + 1] : "";
}

function requiredRow(store, sql, params = []) {
  const result = store.first(sql, params);
  if (!result) throw new Error(`Required record not found: ${sql}`);
  return result;
}

function expect(actual, expected, label) {
  if (Number.isFinite(expected) ? Number(actual) !== expected : actual !== expected) {
    throw new Error(`Precondition failed for ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function preflight(stock, inventory) {
  expect(Number(requiredRow(stock, `SELECT COUNT(*) AS count FROM stockup_shipment_lines
    WHERE inspection_lot_id IN (?,?,?,?)`, [LOT_IDWG011, LOT_IDWG010, LOT_IDWG035, LOT_IDWG039_TAIL]).count), 0, "linked shipment count");

  const lot011 = requiredRow(stock, "SELECT * FROM stockup_inspection_lots WHERE id=?", [LOT_IDWG011]);
  expect(Number(lot011.quantity), 2988, "IDWG011 quantity");
  expect(Number(lot011.carton_count), 36, "IDWG011 carton_count");
  expect(Number(lot011.units_per_carton), 83, "IDWG011 units_per_carton");
  expect(Number(requiredRow(stock, "SELECT carton_width_cm FROM stockup_inspection_lots WHERE id=?", [LOT_IDWG010]).carton_width_cm), 55, "IDWG010 carton_width_cm");
  expect(Number(requiredRow(stock, "SELECT carton_width_cm FROM stockup_inspection_lots WHERE id=?", [LOT_IDWG035]).carton_width_cm), 38, "IDWG035 carton_width_cm");
  const lot039 = requiredRow(stock, "SELECT * FROM stockup_inspection_lots WHERE id=?", [LOT_IDWG039_TAIL]);
  expect(Number(lot039.quantity), 143, "IDWG039 tail quantity");
  expect(Number(lot039.units_per_carton), 143, "IDWG039 tail units_per_carton");
  expect(Number(requiredRow(stock, "SELECT fulfilled_qty FROM stockup_request_lines WHERE id=?", [REQUEST_LINE_IDWG039]).fulfilled_qty), 4463, "IDWG039 fulfilled quantity");
  const workLine039 = requiredRow(stock, "SELECT * FROM stockup_warehouse_work_order_lines WHERE id=?", [LINE_IDWG039]);
  expect(Number(workLine039.good_qty), 4463, "IDWG039 work-order good quantity");
  expect(Number(workLine039.shortage_qty), 0, "IDWG039 work-order shortage");

  for (const [lotId, sku] of [
    [INV_LOT_IDWG011, "TZKJ-IDWG011"],
    [INV_LOT_IDWG010, "TZKJ-IDWG010"],
    [INV_LOT_IDWG035, "TZKJ-IDWG035"],
    [INV_LOT_IDWG039_TAIL, "TZKJ-IDWG039"],
  ]) {
    const lot = requiredRow(inventory, "SELECT * FROM domestic_inventory_lots WHERE id=?", [lotId]);
    expect(lot.warehouse_id, WAREHOUSE_ID, `${sku} warehouse`);
    expect(lot.sku, sku, `${sku} sku`);
  }
  expect(Number(requiredRow(inventory, "SELECT remaining_qty FROM domestic_inventory_lots WHERE id=?", [INV_LOT_IDWG039_TAIL]).remaining_qty), 143, "IDWG039 tail remaining quantity");
  expect(Number(requiredRow(inventory, `SELECT COALESCE(SUM(rl.quantity),0) AS qty
    FROM domestic_inventory_reservation_lines rl JOIN domestic_inventory_reservations r ON r.id=rl.reservation_id
    WHERE rl.lot_id=? AND r.status='reserved'`, [INV_LOT_IDWG039_TAIL]).qty), 0, "IDWG039 tail reserved quantity");
  expect(Number(requiredRow(inventory, "SELECT on_hand_qty FROM domestic_inventory_balances WHERE warehouse_id=? AND sku='TZKJ-IDWG039'", [WAREHOUSE_ID]).on_hand_qty), 4463, "IDWG039 inventory balance");

  return {
    requestNo: REQUEST_NO,
    before: { boxes: 206, units: 28388 },
    after: { boxes: 253, units: 28387 },
    changes: [
      "TZKJ-IDWG011: 36箱×83件 改为 83箱×36件",
      "TZKJ-IDWG010: 外箱宽 55cm 改为 41cm",
      "TZKJ-IDWG035: 外箱宽 38cm 改为 28cm",
      "TZKJ-IDWG039尾箱: 143件 改为 142件，并追加库存调整流水 -1",
    ],
  };
}

function applyStockup(stock, now) {
  const payload = JSON.stringify({
    source: "warehouse_packing_list_2026-10-20",
    before: { boxes: 206, units: 28388 },
    after: { boxes: 253, units: 28387 },
    corrections: [
      { sku: "TZKJ-IDWG011", cartonCount: 83, unitsPerCarton: 36 },
      { sku: "TZKJ-IDWG010", cartonWidthCm: 41 },
      { sku: "TZKJ-IDWG035", cartonWidthCm: 28 },
      { sku: "TZKJ-IDWG039", tailQuantity: 142, shortageQty: 1 },
    ],
  });
  stock.transaction(() => {
    stock.run("UPDATE stockup_inspection_lots SET carton_count=83,units_per_carton=36,updated_at=? WHERE id=?", [now, LOT_IDWG011]);
    stock.run("UPDATE stockup_warehouse_work_order_lines SET carton_count=83,units_per_carton=36,updated_at=? WHERE id=?", [now, LINE_IDWG011]);
    stock.run("UPDATE stockup_inspection_lots SET carton_width_cm=41,updated_at=? WHERE id=?", [now, LOT_IDWG010]);
    stock.run("UPDATE stockup_warehouse_work_order_lines SET carton_width_cm=41,updated_at=? WHERE id=?", [now, LINE_IDWG010]);
    stock.run("UPDATE stockup_inspection_lots SET carton_width_cm=28,updated_at=? WHERE id=?", [now, LOT_IDWG035]);
    stock.run("UPDATE stockup_warehouse_work_order_lines SET carton_width_cm=28,updated_at=? WHERE id=?", [now, LINE_IDWG035]);
    stock.run("UPDATE stockup_inspection_lots SET quantity=142,units_per_carton=142,updated_at=? WHERE id=?", [now, LOT_IDWG039_TAIL]);
    stock.run("UPDATE stockup_warehouse_work_order_lines SET received_qty=4462,good_qty=4462,shortage_qty=1,updated_at=? WHERE id=?", [now, LINE_IDWG039]);
    stock.run("UPDATE stockup_request_lines SET fulfilled_qty=4462,updated_at=? WHERE id=?", [now, REQUEST_LINE_IDWG039]);
    stock.run(`INSERT INTO stockup_progress_events
      (id,request_id,line_id,task_id,shipment_id,receipt_id,event_type,title,description,visibility,actor_id,actor_name,payload_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      EVENT_ID, REQUEST_ID, REQUEST_LINE_IDWG039, "", "", "", "warehouse_data_reconciled",
      "仓库装箱数据已复核校正", "依据 2026-10-20 海运装箱单校正箱规、外箱尺寸和尾箱数量；总计 253 箱、28,387 件。",
      "all", "codex-admin-reconcile", "管理员数据校正", payload, now,
    ]);
  });
}

function applyInventory(inventory, now) {
  const balance = requiredRow(inventory, "SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku='TZKJ-IDWG039'", [WAREHOUSE_ID]);
  inventory.transaction(() => {
    inventory.run("UPDATE domestic_inventory_lots SET carton_count=83,units_per_carton=36,updated_at=? WHERE id=?", [now, INV_LOT_IDWG011]);
    inventory.run("UPDATE domestic_inventory_lots SET carton_width_cm=41,updated_at=? WHERE id=?", [now, INV_LOT_IDWG010]);
    inventory.run("UPDATE domestic_inventory_lots SET carton_width_cm=28,updated_at=? WHERE id=?", [now, INV_LOT_IDWG035]);
    inventory.run("UPDATE domestic_inventory_lots SET units_per_carton=142,remaining_qty=142,updated_at=? WHERE id=?", [now, INV_LOT_IDWG039_TAIL]);
    inventory.run("UPDATE domestic_inventory_balances SET on_hand_qty=4462,updated_at=? WHERE warehouse_id=? AND sku='TZKJ-IDWG039'", [now, WAREHOUSE_ID]);
    inventory.run(`INSERT INTO domestic_inventory_movements
      (id,movement_no,warehouse_id,movement_type,reference_no,occurred_at,note,created_by_id,created_by_name,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [
      ADJUSTMENT_ID, ADJUSTMENT_NO, WAREHOUSE_ID, "adjustment", REQUEST_NO, now,
      "依据 2026-10-20 海运装箱单复核：TZKJ-IDWG039 尾箱实为 142 件，冲减误录 1 件。",
      "codex-admin-reconcile", "管理员数据校正", now,
    ]);
    inventory.run(`INSERT INTO domestic_inventory_movement_lines
      (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      ADJUSTMENT_LINE_ID, ADJUSTMENT_ID, balance.product_id || "", "TZKJ-IDWG039", balance.product_name,
      balance.image_url || "", balance.specification || "", balance.unit, 1, -1, 4463, 4462, 1.71,
    ]);
    inventory.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)", [
      ALLOCATION_ID, ADJUSTMENT_LINE_ID, INV_LOT_IDWG039_TAIL, 1, "selected_lot", now,
    ]);
  });
}

function verify(stock, inventory) {
  const aggregate = requiredRow(stock, `SELECT SUM(quantity) AS units,SUM(carton_count) AS boxes,
    SUM(carton_count*carton_weight_kg) AS estimatedWeight,
    SUM(carton_count*carton_length_cm*carton_width_cm*carton_height_cm/1000000.0) AS estimatedCbm
    FROM stockup_inspection_lots WHERE work_order_id=? AND status='approved'`, [WORK_ORDER_ID]);
  expect(Number(aggregate.units), 28387, "corrected approved units");
  expect(Number(aggregate.boxes), 253, "corrected approved boxes");
  expect(Number(requiredRow(inventory, "SELECT on_hand_qty FROM domestic_inventory_balances WHERE warehouse_id=? AND sku='TZKJ-IDWG039'", [WAREHOUSE_ID]).on_hand_qty), 4462, "corrected IDWG039 inventory balance");
  expect(Number(requiredRow(inventory, "SELECT remaining_qty FROM domestic_inventory_lots WHERE id=?", [INV_LOT_IDWG039_TAIL]).remaining_qty), 142, "corrected IDWG039 tail lot");
  return aggregate;
}

const stockupDb = argument("--stockup-db");
const inventoryDb = argument("--inventory-db");
if (!stockupDb || !inventoryDb) throw new Error("--stockup-db and --inventory-db are required");

const stock = await initStockupCollaborationStore(stockupDb);
const inventory = await initDomesticInventoryStore(inventoryDb);
const report = preflight(stock, inventory);
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ ok: true, dryRun: true, ...report }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
applyStockup(stock, now);
applyInventory(inventory, now);
const verified = verify(stock, inventory);
console.log(JSON.stringify({ ok: true, applied: true, ...report, verified }, null, 2));
