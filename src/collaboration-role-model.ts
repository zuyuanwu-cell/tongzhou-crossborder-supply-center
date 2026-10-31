import type { CollaborationOrganizationType, CollaborationPartnerTaskType } from "./collaboration-identity-admin-api";

export type PartnerRoleDefinition = {
  taskType: CollaborationPartnerTaskType;
  label: string;
  shortLabel: string;
  description: string;
  hash: string;
  eligibleOrganizationTypes: CollaborationOrganizationType[];
  resourceRef: "production" | "procurement" | "sampling";
  viewPermission: string;
};

export const partnerRoleDefinitions: PartnerRoleDefinition[] = [
  {
    taskType: "production_order",
    label: "委外加工协同",
    shortLabel: "委外加工",
    description: "同步加工单，跟进物料齐套、生产进度、质检、异常与发货。",
    hash: "#outsourcing-collaboration",
    eligibleOrganizationTypes: ["production_factory"],
    resourceRef: "production",
    viewPermission: "production.order.view",
  },
  {
    taskType: "purchase_order",
    label: "物料采购协同",
    shortLabel: "物料供应",
    description: "向物料、包材供应商或兼任供应商的委外工厂发布采购单。",
    hash: "#procurement-collaboration",
    eligibleOrganizationTypes: ["material_supplier", "packaging_factory", "production_factory"],
    resourceRef: "procurement",
    viewPermission: "procurement.order.view",
  },
  {
    taskType: "sampling_task",
    label: "打样协同",
    shortLabel: "打样",
    description: "闭环管理内料、包装盒与包装瓶的多轮送样、评审定版和定版报价。",
    hash: "#material-sampling-collaboration",
    eligibleOrganizationTypes: ["sampling_factory", "production_factory", "material_supplier", "packaging_factory"],
    resourceRef: "sampling",
    viewPermission: "sampling.task.view",
  },
];

export function roleDefinition(taskType: CollaborationPartnerTaskType) {
  return partnerRoleDefinitions.find((role) => role.taskType === taskType) || partnerRoleDefinitions[0];
}

export function organizationRoleLabels(organizationType: CollaborationOrganizationType) {
  const labels: Record<CollaborationOrganizationType, string[]> = {
    warehouse: ["仓储协同"],
    filing_service: ["备案协同"],
    sampling_factory: ["打样"],
    packaging_factory: ["包材供应", "包材打样", "包装询价"],
    production_factory: ["委外加工", "物料供应", "打样"],
    material_supplier: ["物料供应", "内料打样"],
    internal: [],
  };
  return labels[organizationType] || [];
}

export function organizationSupportsTask(organizationType: CollaborationOrganizationType, taskType: CollaborationPartnerTaskType) {
  return roleDefinition(taskType).eligibleOrganizationTypes.includes(organizationType);
}
