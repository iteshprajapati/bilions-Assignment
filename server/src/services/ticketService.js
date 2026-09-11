import { query } from '../db/pool.js';
import { calculateSla } from '../utils/sla.js';

const PAGE_SIZE = 20;

export async function listTickets({ orgId, page = 1, search = '', status, priority, sortBy = 'created_at', order = 'desc' }) {
  const where = ['t.org_id = ?'];
  const params = [orgId];

  if (search) {
    where.push('t.subject LIKE ?');
    params.push(`%${search}%`);
  }
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (priority) {
    where.push('t.priority = ?');
    params.push(priority);
  }

  const whereSql = where.join(' AND ');
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
            t.assignee_id,
            u.name  AS assignee_name,
            r.name  AS requester_name,
            (SELECT MIN(c.created_at)
               FROM comments c
               JOIN users    cu ON cu.id = c.author_id
              WHERE c.ticket_id = t.id
                AND cu.role IN ('agent','admin')
            ) AS responded_at
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN  users r ON r.id = t.requester_id
      WHERE ${whereSql}
      ORDER BY t.${sortBy} ${order}
      LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  // Attach comment count and computed SLA fields to each row.
  for (const row of rows) {
    const [{ c }] = await query('SELECT COUNT(*) AS c FROM comments WHERE ticket_id = ?', [row.id]);
    row.comment_count = c;
    Object.assign(row, calculateSla(row));
  }

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM tickets t WHERE ${whereSql}`,
    params
  );

  return { rows, total, page, pageSize: PAGE_SIZE };
}

export async function getTicketById(id) {
  const rows = await query(
    `SELECT t.*,
            u.name  AS assignee_name,
            r.name  AS requester_name,
            r.email AS requester_email,
            (SELECT MIN(c.created_at)
               FROM comments c
               JOIN users    cu ON cu.id = c.author_id
              WHERE c.ticket_id = t.id
                AND cu.role IN ('agent','admin')
            ) AS responded_at
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assignee_id
       JOIN  users r ON r.id = t.requester_id
      WHERE t.id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  const ticket = rows[0];
  Object.assign(ticket, calculateSla(ticket));
  return ticket;
}

export async function listComments(ticketId) {
  return query(
    `SELECT c.id, c.body, c.is_internal, c.created_at, u.name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC`,
    [ticketId]
  );
}

export async function createTicket({ orgId, subject, body, priority, requesterId }) {
  const result = await query(
    `INSERT INTO tickets (org_id, subject, body, priority, requester_id)
     VALUES (?, ?, ?, ?, ?)`,
    [orgId, subject, body, priority, requesterId]
  );
  return getTicketById(result.insertId);
}

export async function assignTicket(ticketId, assigneeId) {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return null;

  if (ticket.assignee_id) {
    return { conflict: true, ticket };
  }

  // Look up the agent so the response carries a display name for the toast.
  const [agent] = await query('SELECT id, name FROM users WHERE id = ?', [assigneeId]);

  await query('UPDATE tickets SET assignee_id = ?, status = ? WHERE id = ?', [assigneeId, 'pending', ticketId]);
  return { conflict: false, assignedTo: agent, ticket: await getTicketById(ticketId) };
}

export async function deleteTicket(id) {
  await query('DELETE FROM tickets WHERE id = ?', [id]);
}
