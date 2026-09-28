UPDATE organization_memberships
   SET mfa_required = false
 WHERE mfa_required = true;

UPDATE collaboration_invitations
   SET mfa_required = false
 WHERE mfa_required = true
   AND accepted_at IS NULL;
