import React from "react";
import { ClipboardCheck, Headphones, WalletCards, Warehouse } from "lucide-react";
import { AuthUser } from "./api";
import { AfterSalesCenter } from "./AfterSalesCenter";
import { WarehouseTicketCenter } from "./WarehouseTicketCenter";
import { WarehouseLiabilitySettlement } from "./WarehouseLiabilitySettlement";

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

export function WarehouseCollaborationCenter({ currentUser }: { currentUser: AuthUser }) {
  const canAfterSales = hasPermission(currentUser, "after_sales_report") || hasPermission(currentUser, "after_sales_warehouse") || hasPermission(currentUser, "warehouse_return_query");
  const canTickets = hasPermission(currentUser, "warehouse_ticket_report") || hasPermission(currentUser, "warehouse_ticket_warehouse");
  const canSettlement = hasPermission(currentUser, "warehouse_liability_settlement");
  const readDeepLink = React.useCallback(() => {
    const query = new URLSearchParams(window.location.hash.split("?", 2)[1] || "");
    const requestedModule = query.get("module");
    const requestedView = query.get("view");
    return {
      module: requestedModule === "settlement" && canSettlement
          ? "settlement" as const
          : requestedModule === "tickets" && canTickets
          ? "tickets" as const
          : requestedModule === "after_sales" && canAfterSales
            ? "after_sales" as const
          : canAfterSales
              ? "after_sales" as const
              : canTickets
                ? "tickets" as const
                : "settlement" as const,
      ticketId: query.get("ticket") || "",
      view: requestedView === "warehouse" ? "warehouse" as const : requestedView === "mine" ? "mine" as const : requestedView === "returns" ? "returns" as const : requestedView === "create" ? "create" as const : "" as const,
      warehouseId: query.get("warehouseId") || "",
      relatedOrderNumber: query.get("relatedOrder") || "",
      category: query.get("category") || "",
      title: query.get("title") || "",
      description: query.get("description") || "",
    };
  }, [canAfterSales, canSettlement, canTickets]);
  const [deepLink, setDeepLink] = React.useState(readDeepLink);
  const module = deepLink.module;

  React.useEffect(() => {
    const sync = () => setDeepLink(readDeepLink());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [readDeepLink]);

  function changeModule(nextModule: "after_sales" | "tickets" | "settlement") {
    setDeepLink({ module: nextModule, ticketId: "", view: "", warehouseId: "", relatedOrderNumber: "", category: "", title: "", description: "" });
    window.history.replaceState(null, "", `#after-sales?module=${nextModule}`);
  }

  return <div className="warehouse-collaboration-page">
    <section className="warehouse-collaboration-hero">
      <div><p className="eyebrow">OVERSEAS WAREHOUSE</p><h2>海外仓协同中心</h2><span>海外仓售后责任、补发处理与日常工单统一协同，所有进度可追踪、可通知。</span></div>
      <Warehouse size={42} />
    </section>
    <nav className="warehouse-module-tabs" aria-label="海外仓协同业务板块">
      {canAfterSales ? <button className={module === "after_sales" ? "active" : ""} onClick={() => changeModule("after_sales")}><Headphones size={20} /><span><strong>售后订单</strong><small>责任判定、补发、驳回与结算</small></span></button> : null}
      {canTickets ? <button className={module === "tickets" ? "active" : ""} onClick={() => changeModule("tickets")}><ClipboardCheck size={20} /><span><strong>仓库工单</strong><small>订单催促与日常问题反馈</small></span></button> : null}
      {canSettlement ? <button className={module === "settlement" ? "active" : ""} onClick={() => changeModule("settlement")}><WalletCards size={20} /><span><strong>费用核销</strong><small>责任费用导出、扣款与冲销</small></span></button> : null}
    </nav>
    {module === "after_sales" && canAfterSales ? <AfterSalesCenter currentUser={currentUser} embedded initialTicketId={deepLink.ticketId} initialView={deepLink.view === "create" ? "" : deepLink.view} /> : null}
    {module === "tickets" && canTickets ? <WarehouseTicketCenter currentUser={currentUser} initialTicketId={deepLink.ticketId} initialView={deepLink.view === "returns" ? "" : deepLink.view} initialPrefill={{ warehouseId: deepLink.warehouseId, relatedOrderNumber: deepLink.relatedOrderNumber, category: deepLink.category, title: deepLink.title, description: deepLink.description }} /> : null}
    {module === "settlement" && canSettlement ? <WarehouseLiabilitySettlement /> : null}
  </div>;
}
