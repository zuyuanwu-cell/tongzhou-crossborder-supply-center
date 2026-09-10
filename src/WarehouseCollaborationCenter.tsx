import React from "react";
import { ClipboardCheck, Headphones, Warehouse } from "lucide-react";
import { AuthUser } from "./api";
import { AfterSalesCenter } from "./AfterSalesCenter";
import { WarehouseTicketCenter } from "./WarehouseTicketCenter";

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

export function WarehouseCollaborationCenter({ currentUser }: { currentUser: AuthUser }) {
  const canAfterSales = hasPermission(currentUser, "after_sales_report") || hasPermission(currentUser, "after_sales_warehouse");
  const canTickets = hasPermission(currentUser, "warehouse_ticket_report") || hasPermission(currentUser, "warehouse_ticket_warehouse");
  const [module, setModule] = React.useState<"after_sales" | "tickets">(canAfterSales ? "after_sales" : "tickets");

  return <div className="warehouse-collaboration-page">
    <section className="warehouse-collaboration-hero">
      <div><p className="eyebrow">WAREHOUSE COLLABORATION</p><h2>仓库协同中心</h2><span>售后责任、补发处理与日常仓库工单统一协同，所有进度可追踪、可通知。</span></div>
      <Warehouse size={42} />
    </section>
    <nav className="warehouse-module-tabs" aria-label="仓库协同业务板块">
      {canAfterSales ? <button className={module === "after_sales" ? "active" : ""} onClick={() => setModule("after_sales")}><Headphones size={20} /><span><strong>售后订单</strong><small>责任判定、补发、驳回与结算</small></span></button> : null}
      {canTickets ? <button className={module === "tickets" ? "active" : ""} onClick={() => setModule("tickets")}><ClipboardCheck size={20} /><span><strong>仓库工单</strong><small>订单催促与日常问题反馈</small></span></button> : null}
    </nav>
    {module === "after_sales" && canAfterSales ? <AfterSalesCenter currentUser={currentUser} embedded /> : null}
    {module === "tickets" && canTickets ? <WarehouseTicketCenter currentUser={currentUser} /> : null}
  </div>;
}
