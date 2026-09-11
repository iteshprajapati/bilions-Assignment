import { config } from '../config.js';

export function calculateSla(ticket) {
  const targetHours = config.slaTargets[ticket.priority];

  if (!targetHours) {
    return { isBreached: false, slaDeadline: null, slaRemainingMinutes: null };
  }

  const createdAt = new Date(ticket.created_at);
  const deadline  = new Date(createdAt.getTime() + targetHours * 3_600_000);

  const compareTime = ticket.responded_at ? new Date(ticket.responded_at) : new Date();

  const remainingMinutes = Math.round((deadline - compareTime) / 60_000);

  return {
    isBreached:          compareTime > deadline,
    slaDeadline:         deadline.toISOString(),
    slaRemainingMinutes: remainingMinutes,
  };
}
