UPDATE integration_outbox AS outbox
   SET status = 'sent',
       sent_at = COALESCE(outbox.sent_at, command.processed_at, now()),
       last_error = NULL
  FROM partner_commands AS command
 WHERE outbox.aggregate_type = 'partner_command'
   AND outbox.aggregate_id = command.id::text
   AND command.status IN ('applied', 'rejected', 'failed')
   AND outbox.status <> 'sent';

CREATE INDEX IF NOT EXISTS idx_work_items_overdue
  ON work_items(due_at, status)
  WHERE due_at IS NOT NULL
    AND status IN ('pending', 'accepted', 'in_progress', 'pending_approval', 'pending_sync');
