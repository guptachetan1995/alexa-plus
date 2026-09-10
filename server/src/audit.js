'use strict';

const { randomUUID } = require('node:crypto');

/**
 * In-memory, append-only audit trail. Matches SPEC.md's `AuditEntry` data model. There
 * is no delete/redact path on purpose — read_audit_log (tools.js) is the only reader.
 */
class AuditLog {
  constructor() {
    this._entries = [];
  }

  /** Appends one entry, stamping entry_id/timestamp; returns the stored entry. */
  record({ device_id: deviceId, action, params, actor, reason, result, new_state: newState }) {
    const entry = {
      entry_id: `audit_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      device_id: deviceId,
      action,
      params,
      actor,
      reason,
      result,
      new_state: newState,
    };
    this._entries.push(entry);
    return entry;
  }

  /** Entries newest-first, optionally filtered by device, capped at `limit`. */
  list({ device_id: deviceId, limit = 50 } = {}) {
    let entries = this._entries.slice().reverse();
    if (deviceId) {
      entries = entries.filter((e) => e.device_id === deviceId);
    }
    return entries.slice(0, limit);
  }
}

module.exports = { AuditLog };
