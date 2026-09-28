import nodemailer from "nodemailer";
import { collaborationConfig } from "./config.js";
import { withSystem } from "./db.js";

const transporter = collaborationConfig.smtpUrl ? nodemailer.createTransport(collaborationConfig.smtpUrl) : null;

export async function sendSecurityEmail({ to, subject, text }) {
  if (!transporter || !to) return { sent: false, reason: "smtp_not_configured" };
  await transporter.sendMail({ to, subject, text });
  return { sent: true };
}

async function deliver(notification) {
  if (notification.channel === "email") {
    if (!transporter || !notification.email) throw new Error("Email delivery is not configured.");
    await transporter.sendMail({ to: notification.email, subject: notification.title, text: notification.body });
    return;
  }
  if (notification.channel === "wecom") {
    const webhook = notification.webhook || collaborationConfig.wecomWebhook;
    if (!webhook) throw new Error("WeCom delivery is not configured.");
    const response = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msgtype: "text", text: { content: `${notification.title}\n${notification.body}` } }) });
    if (!response.ok) throw new Error(`WeCom returned HTTP ${response.status}.`);
  }
}

export async function runNotificationDeliveryBatch() {
  const rows = await withSystem(async (client) => {
    const result = await client.query(
      `SELECT n.*,u.email,o.metadata
         FROM notifications n
         LEFT JOIN collaboration_users u ON u.id=n.user_id
         JOIN organizations o ON o.id=n.organization_id
        WHERE n.channel IN ('email','wecom') AND n.delivery_status IN ('pending','failed')
          AND COALESCE(n.next_attempt_at,now()) <= now() AND n.attempt_count < 6
        ORDER BY n.created_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of result.rows) await client.query("UPDATE notifications SET delivery_status='pending',attempt_count=attempt_count+1 WHERE id=$1", [row.id]);
    return result.rows;
  });
  for (const row of rows) {
    try {
      await deliver({ ...row, webhook: row.metadata?.wecomWebhook || "" });
      await withSystem((client) => client.query("UPDATE notifications SET delivery_status='sent',delivered_at=now(),last_error=NULL WHERE id=$1", [row.id]));
    } catch (error) {
      await withSystem((client) => client.query("UPDATE notifications SET delivery_status='failed',last_error=$2,next_attempt_at=now() + (interval '1 minute' * power(2,LEAST(attempt_count,6))) WHERE id=$1", [row.id, String(error.message || error).slice(0, 1_000)]));
    }
  }
  return { attempted: rows.length };
}
