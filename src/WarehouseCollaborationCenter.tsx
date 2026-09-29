import React from "react";
import { ClipboardCheck, Headphones, ListChecks, Warehouse } from "lucide-react";
import { AuthUser } from "./api";
import { AfterSalesCenter } from "./AfterSalesCenter";
import { WarehouseTicketCenter } from "./WarehouseTicketCenter";
import { WarehouseCollaborationTasks } from "./WarehouseCollaborationTasks";

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

export function WarehouseCollaborationCenter({ currentUser }: { currentUser: AuthUser }) {
  const canAfterSales = hasPermission(currentUser, "after_sales_report") || hasPermission(currentUser, "after_sales_warehouse") || hasPermission(currentUser, "warehouse_return_query");
  const canTickets = hasPermission(currentUser, "warehouse_ticket_report") || hasPermission(currentUser, "warehouse_ticket_warehouse");
  const canCollaborationTasks = hasPermission(currentUser, "collaboration_task_view") || hasPermission(currentUser, "collaboration_task_publish");
  const readDeepLink = React.useCallback(() => {
    const query = new URLSearchParams(window.location.hash.split("?", 2)[1] || "");
    const requestedModule = query.get("module");
    const requestedView = query.get("view");
    return {
      module: requestedModule === "collaboration_tasks" && canCollaborationTasks
        ? "collaboration_tasks" as const
        : requestedModule === "tickets" && canTickets
          ? "tickets" as const
          : requestedModule === "after_sales" && canAfterSales
            ? "after_sales" as const
          : canCollaborationTasks
            ? "collaboration_tasks" as const
            : canAfterSales
              ? "after_sales" as const
              : "tickets" as const,
      ticketId: query.get("ticket") || "",
      view: requestedView === "warehouse" ? "warehouse" as const : requestedView === "mine" ? "mine" as const : requestedView === "returns" ? "returns" as const : requestedView === "create" ? "create" as const : "" as const,
      warehouseId: query.get("warehouseId") || "",
      relatedOrderNumber: query.get("relatedOrder") || "",
      category: query.get("category") || "",
      title: query.get("title") || "",
      description: query.get("description") || "",
    };
  }, [canAfterSales, canCollaborationTasks, canTickets]);
  const [deepLink, setDeepLink] = React.useState(readDeepLink);
  const module = deepLink.module;

  React.useEffect(() => {
    const sync = () => setDeepLink(readDeepLink());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [readDeepLink]);

  function changeModule(nextModule: "after_sales" | "tickets" | "collaboration_tasks") {
    setDeepLink({ module: nextModule, ticketId: "", view: "", warehouseId: "", relatedOrderNumber: "", category: "", title: "", description: "" });
    window.history.replaceState(null, "", `#after-sales?module=${nextModule}`);
  }

  return <div className="warehouse-collaboration-page">
    <section className="warehouse-collaboration-hero">
      <div><p className="eyebrow">WAREHOUSE COLLABORATION</p><h2>仓库协同中心</h2><span>售后责任、补发处理与日常仓库工单统一协同，所有进度可追踪、可通知。</span></div>
      <Warehouse size={42} />
    </section>
    <nav className="warehouse-module-tabs" aria-label="仓库协同业务板块">
      {canCollaborationTasks ? <button className={module === "collaboration_tasks" ? "active" : ""} onClick={() => changeModule("collaboration_tasks")}><ListChecks size={20} /><span><strong>协同任务</strong><small>向伙伴发布工单并追踪处理进度</small></span></button> : null}
      {canAfterSales ? <button className={module === "after_sales" ? "active" : ""} onClick={() => changeModule("after_sales")}><Headphones size={20} /><span><strong>售后订单</strong><small>责任判定、补发、驳回与结算</small></span></button> : null}
      {canTickets ? <button className={module === "tickets" ? "active" : ""} onClick={() => changeModule("tickets")}><ClipboardCheck size={20} /><span><strong>仓库工单</strong><small>订单催促与日常问题反馈</small></span></button> : null}
    </nav>
    {module === "collaboration_tasks" && canCollaborationTasks ? <WarehouseCollaborationTasks currentUser={currentUser} /> : null}
    {module === "after_sales" && canAfterSales ? <AfterSalesCenter currentUser={currentUser} embedded initialTicketId={deepLink.ticketId} initialView={deepLink.view === "create" ? "" : deepLink.view} /> : null}
    {module === "tickets" && canTickets ? <WarehouseTicketCenter currentUser={currentUser} initialTicketId={deepLink.ticketId} initialView={deepLink.view === "returns" ? "" : deepLink.view} initialPrefill={{ warehouseId: deepLink.warehouseId, relatedOrderNumber: deepLink.relatedOrderNumber, category: deepLink.category, title: deepLink.title, description: deepLink.description }} /> : null}
  </div>;
}
