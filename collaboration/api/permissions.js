const actionRoles = Object.freeze({
  accept: new Set(["organization_admin", "manager", "operator"]),
  progress: new Set(["organization_admin", "manager", "operator"]),
  report_exception: new Set(["organization_admin", "manager", "operator"]),
  inbound_confirm: new Set(["organization_admin", "manager", "operator"]),
  outbound_confirm: new Set(["organization_admin", "manager", "operator"]),
  transfer_receive: new Set(["organization_admin", "manager", "operator"]),
  inventory_adjustment: new Set(["organization_admin", "manager"]),
  complete: new Set(["organization_admin", "manager"]),
});

export function canPerformAction(membership, action) {
  if (!membership || membership.status !== "active") return false;
  return Boolean(actionRoles[action]?.has(membership.role));
}

export function requiresMfaAtLogin() {
  return false;
}
