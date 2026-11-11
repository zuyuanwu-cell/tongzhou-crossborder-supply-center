function rowsForWarehouse(rows, warehouseId) {
  return (Array.isArray(rows) ? rows : []).filter((item) => String(item?.warehouseId || "") === String(warehouseId || ""));
}

export async function collectWarehouseInventorySync({
  connections = [],
  syncConnection,
  previousProducts = [],
  previousInventory = [],
} = {}) {
  if (typeof syncConnection !== "function") throw new TypeError("syncConnection is required");
  const results = [];
  const products = [];
  const inventory = [];

  for (const connection of connections) {
    try {
      const result = await syncConnection(connection);
      const nextProducts = Array.isArray(result?.products) ? result.products : [];
      const nextInventory = Array.isArray(result?.inventory) ? result.inventory : [];
      results.push({
        warehouseId: result?.warehouseId || connection?.id || "",
        ok: result?.ok === true,
        skipped: result?.skipped === true,
        stale: false,
        message: String(result?.message || ""),
        productCount: nextProducts.length,
        inventoryCount: nextInventory.length,
      });
      products.push(...nextProducts);
      inventory.push(...nextInventory);
    } catch (error) {
      const staleProducts = rowsForWarehouse(previousProducts, connection?.id);
      const staleInventory = rowsForWarehouse(previousInventory, connection?.id);
      results.push({
        warehouseId: connection?.id || "",
        ok: false,
        skipped: false,
        stale: true,
        message: String(error?.message || "Warehouse inventory sync failed"),
        productCount: staleProducts.length,
        inventoryCount: staleInventory.length,
      });
      products.push(...staleProducts);
      inventory.push(...staleInventory);
    }
  }

  return { results, products, inventory };
}
