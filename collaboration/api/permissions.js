const actionRoles = Object.freeze({
  accept: new Set(["organization_admin", "manager", "operator"]),
  progress: new Set(["organization_admin", "manager", "operator"]),
  report_exception: new Set(["organization_admin", "manager", "operator"]),
  inbound_confirm: new Set(["organization_admin", "manager", "operator"]),
  outbound_confirm: new Set(["organization_admin", "manager", "operator"]),
  transfer_receive: new Set(["organization_admin", "manager", "operator"]),
  inventory_adjustment: new Set(["organization_admin", "manager"]),
  stockup_process: new Set(["organization_admin", "manager", "operator"]),
  complete: new Set(["organization_admin", "manager"]),
});

export function allowedActions(membership) {
  if (!membership || membership.status !== "active") return [];
  return Object.keys(actionRoles).filter((action) => actionRoles[action].has(membership.role));
}

export function canPerformAction(membership, action) {
  return allowedActions(membership).includes(action);
}

export function requiresMfaAtLogin() {
  return false;
}
