import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { DataContextBar, ResourceBoundary } from "../collaboration/shared/OperationalUi";
import { fetchWarehouseQualificationCoverage, type WarehouseQualificationCoveragePayload } from "./api";
import QualificationCoveragePage from "./QualificationCoveragePage";

export function WarehouseQualificationCoveragePage() {
  const [payload, setPayload] = React.useState<WarehouseQualificationCoveragePayload | null>(null);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [refreshToken, setRefreshToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    if (payload) setRefreshing(true);
    else setLoading(true);
    setError("");
    fetchWarehouseQualificationCoverage({ warehouseId }, controller.signal)
      .then((result) => {
        setPayload(result);
        if (!warehouseId && result.warehouse?.id) setWarehouseId(result.warehouse.id);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "本仓资质覆盖读取失败");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => controller.abort();
  // A new request is expected whenever the warehouse or explicit refresh changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, refreshToken]);

  const reload = React.useCallback(() => setRefreshToken((value) => value + 1), []);
  const warehouseUnavailable = Boolean(payload?.warehouse && payload.dataContext?.completeness === "unavailable" && payload.warehouse.productCount === 0);
  const noWarehouseScope = Boolean(payload && !payload.warehouses.length);
  return <section className="warehouse-qualification-workspace">
    <DataContextBar context={payload?.dataContext} loading={loading && !payload} refreshing={refreshing} error={error} onRetry={reload} />
    {payload && !payload.qualificationAvailable ? <div className="notice warning" role="status"><AlertTriangle size={16} />资质数据尚未完成同步，当前库存商品标记为“待同步”，不会按未覆盖或 0 处理。</div> : null}
    <ResourceBoundary
      loading={loading}
      hasData={Boolean(payload)}
      error={!payload ? error : ""}
      empty={noWarehouseScope || warehouseUnavailable}
      emptyTitle={noWarehouseScope ? "当前账号没有可查询的海外仓" : "本仓库存数据尚未同步"}
      emptyDescription={noWarehouseScope ? "请管理员先为该仓库账号绑定负责仓库；未绑定时系统不会返回任何仓库或商品数据。" : "完成该海外仓的库存同步后，系统会按正库存商品计算资质覆盖；当前不会把未知状态显示成 0。"}
      onRetry={reload}
    >
      {payload?.warehouses.length ? <>
        <div className="warehouse-qualification-actions"><span>仅显示状态、生效日期和到期日期，不开放证书文件。</span><button className="ghost-button compact-button" type="button" onClick={reload} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={15} />刷新</button></div>
        <QualificationCoveragePage
          products={[]}
          productBase={[]}
          warehouseOnlyInventory={[]}
          qualificationPayload={null}
          precomputedCoverage={payload}
          selectedWarehouseId={warehouseId || payload.warehouse?.id || ""}
          onWarehouseChange={setWarehouseId}
          readOnly
        />
      </> : null}
    </ResourceBoundary>
  </section>;
}
