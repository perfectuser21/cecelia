/**
 * 内存 mock DB — 支持 skill_eval_tasks 表 CRUD，CI 无需真实 PostgreSQL
 */
class MemoryDb {
  constructor() {
    this._tables = { skill_eval_tasks: [] };
  }

  async one(sql, values = []) {
    const result = await this._execute(sql, values);
    if (!result || result.length === 0) throw new Error(`No data returned for: ${sql.substring(0, 80)}`);
    return result[0];
  }

  async oneOrNone(sql, values = []) {
    const result = await this._execute(sql, values);
    return (!result || result.length === 0) ? null : result[0];
  }

  async none(sql, values = []) { await this._execute(sql, values); return null; }

  async manyOrNone(sql, values = []) {
    return (await this._execute(sql, values)) || [];
  }

  async any(sql, values = []) { return this.manyOrNone(sql, values); }

  async _execute(sql, values = []) {
    const normalized = sql.trim().replace(/\s+/g, ' ');
    const upper = normalized.toUpperCase();

    let filled = normalized;
    if (values && values.length > 0) {
      filled = normalized.replace(/\$(\d+)/g, (_, idx) => {
        const val = values[parseInt(idx) - 1];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        return String(val);
      });
    }

    const filledUpper = filled.toUpperCase();

    if (filledUpper.includes('CREATE TABLE') || filledUpper.includes('INSERT INTO SCHEMA_VERSION')) return [];
    if (filledUpper.startsWith('TRUNCATE')) { this._tables.skill_eval_tasks = []; return []; }
    if (filledUpper.startsWith('INSERT INTO SKILL_EVAL_TASKS')) return this._handleInsert(filled);
    if (filledUpper.startsWith('UPDATE SKILL_EVAL_TASKS')) return this._handleUpdate(filled);
    if (filledUpper.startsWith('SELECT')) return this._handleSelect(filled);
    if (filledUpper.startsWith('DELETE FROM SKILL_EVAL_TASKS')) return this._handleDelete(filled);
    return [];
  }

  _handleInsert(sql) {
    const colMatch = sql.match(/\(([^)]+)\)\s+VALUES\s+(.+)/is);
    if (!colMatch) return [];
    const cols = colMatch[1].split(',').map(c => c.trim().toLowerCase());
    for (const vals of this._parseValueGroups(colMatch[2].trim())) {
      const row = this._makeDefaultRow();
      for (let i = 0; i < cols.length; i++) {
        let val = vals[i];
        if (val === undefined || val === 'NULL' || val === 'null') {
          row[cols[i]] = null;
        } else if (/^NOW\(\)$/i.test(val)) {
          row[cols[i]] = new Date();
        } else {
          const intervalMatch = val.match(/^NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s*(seconds?|minutes?|hours?|days?)'/i);
          if (intervalMatch) {
            const amount = parseInt(intervalMatch[1]);
            const unit = intervalMatch[2].toLowerCase();
            let ms = amount * 1000;
            if (unit.startsWith('minute')) ms = amount * 60 * 1000;
            else if (unit.startsWith('hour')) ms = amount * 3600 * 1000;
            else if (unit.startsWith('day')) ms = amount * 86400 * 1000;
            row[cols[i]] = new Date(Date.now() - ms);
          } else {
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1).replace(/''/g, "'");
            row[cols[i]] = val;
          }
        }
      }
      this._tables.skill_eval_tasks.push(row);
    }
    return [];
  }

  _parseValueGroups(valsPart) {
    const groups = [];
    let depth = 0, current = '', inStr = false;
    for (let i = 0; i < valsPart.length; i++) {
      const ch = valsPart[i];
      if (ch === "'" && !inStr) { inStr = true; current += ch; continue; }
      if (ch === "'" && inStr) {
        if (valsPart[i+1] === "'") { current += "''"; i++; continue; }
        inStr = false; current += ch; continue;
      }
      if (inStr) { current += ch; continue; }
      if (ch === '(') { if (depth === 0) { current = ''; depth++; continue; } depth++; current += ch; }
      else if (ch === ')') { depth--; if (depth === 0) { groups.push(this._splitValues(current.trim())); current = ''; } else current += ch; }
      else current += ch;
    }
    return groups;
  }

  _splitValues(str) {
    const vals = [];
    let depth = 0, inStr = false, current = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && !inStr) { inStr = true; current += ch; continue; }
      if (ch === "'" && inStr) { if (str[i+1] === "'") { current += "''"; i++; continue; } inStr = false; current += ch; continue; }
      if (inStr) { current += ch; continue; }
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) { vals.push(current.trim()); current = ''; }
      else current += ch;
    }
    if (current.trim()) vals.push(current.trim());
    return vals;
  }

  _makeDefaultRow() {
    return {
      task_id: null, zip_hash: null, zip_path: null, skill_name: 'unknown',
      platform: 'unknown', report_url: null, submitter: null,
      pending_reason: null, failure_reason: null, container_id: null,
      status: 'pending', created_at: new Date(), started_at: null,
      completed_at: null, updated_at: new Date(),
    };
  }

  _handleUpdate(sql) {
    const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is);
    if (!setMatch) return [];
    const assignments = this._parseSetClause(setMatch[1].trim());
    const condition = setMatch[2] ? this._parseWhereClause(setMatch[2].trim()) : () => true;
    for (const row of this._tables.skill_eval_tasks) {
      if (condition(row)) {
        for (const [key, val] of Object.entries(assignments)) {
          if (val === 'NOW()') row[key] = new Date();
          else if (val === null) row[key] = null;
          else row[key] = val;
        }
      }
    }
    return [];
  }

  _parseSetClause(clause) {
    const result = {};
    const parts = [];
    let inStr = false, current = '';
    for (let i = 0; i < clause.length; i++) {
      const ch = clause[i];
      if (ch === "'") inStr = !inStr;
      if (ch === ',' && !inStr) { parts.push(current.trim()); current = ''; }
      else current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx < 0) continue;
      const col = part.substring(0, eqIdx).trim().toLowerCase();
      let val = part.substring(eqIdx + 1).trim();
      if (val.toUpperCase() === 'NOW()') val = 'NOW()';
      else if (val.toUpperCase() === 'NULL') val = null;
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1).replace(/''/g, "'");
      result[col] = val;
    }
    return result;
  }

  _parseWhereClause(where) {
    return (row) => {
      for (const cond of this._splitAnd(where)) {
        const trimmed = cond.trim();
        const inMatch = trimmed.match(/^(\w+)\s+IN\s+\((.+)\)$/i);
        if (inMatch) {
          const col = inMatch[1].toLowerCase();
          const inVals = inMatch[2].split(',').map(v => {
            v = v.trim();
            return (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v;
          });
          if (!inVals.includes(String(row[col] || ''))) return false;
          continue;
        }
        const intervalMatch = trimmed.match(/^(\w+)\s*<\s*NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s+seconds'/i);
        if (intervalMatch) {
          const col = intervalMatch[1].toLowerCase();
          const threshold = new Date(Date.now() - parseInt(intervalMatch[2]) * 1000);
          if (!row[col] || new Date(row[col]) >= threshold) return false;
          continue;
        }
        const eqMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
        if (eqMatch) { if (String(row[eqMatch[1].toLowerCase()] || '') !== eqMatch[2]) return false; continue; }
        const eqNumMatch = trimmed.match(/^(\w+)\s*=\s*(\S+)$/);
        if (eqNumMatch) { if (String(row[eqNumMatch[1].toLowerCase()] || '') !== eqNumMatch[2]) return false; }
      }
      return true;
    };
  }

  _splitAnd(where) {
    const parts = [];
    let inStr = false, current = '', i = 0;
    while (i < where.length) {
      const ch = where[i];
      if (ch === "'") { inStr = !inStr; current += ch; i++; continue; }
      if (!inStr && where.substring(i, i+4).toUpperCase() === ' AND') { parts.push(current.trim()); current = ''; i += 4; continue; }
      current += ch; i++;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  _handleSelect(sql) {
    const fromMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+skill_eval_tasks/is);
    if (!fromMatch) return [];
    const fields = fromMatch[1].trim();
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|$)/is);
    const condition = whereMatch ? this._parseWhereClause(whereMatch[1].trim()) : () => true;
    const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
    const orderCol = orderMatch ? orderMatch[1].toLowerCase() : null;
    const orderDir = (orderMatch && orderMatch[2] && orderMatch[2].toUpperCase() === 'DESC') ? -1 : 1;
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1]) : null;

    let rows = this._tables.skill_eval_tasks.filter(condition);
    if (orderCol) {
      rows = rows.slice().sort((a, b) => {
        const av = a[orderCol], bv = b[orderCol];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -orderDir : av > bv ? orderDir : 0;
      });
    }
    if (limit !== null) rows = rows.slice(0, limit);
    return rows.map(row => this._project(row, fields));
  }

  _project(row, fields) {
    if (fields.trim() === '*') return { ...row };
    const result = {};
    for (const field of fields.split(',').map(f => f.trim())) {
      const aliasMatch = field.match(/^(\w+)\s+as\s+(\w+)$/i);
      if (aliasMatch) { result[aliasMatch[2].toLowerCase()] = row[aliasMatch[1].toLowerCase()]; continue; }
      const col = field.toLowerCase();
      result[col] = row[col] !== undefined ? row[col] : null;
    }
    return result;
  }

  _handleDelete(sql) {
    const whereMatch = sql.match(/WHERE\s+(.+)$/is);
    if (!whereMatch) { this._tables.skill_eval_tasks = []; return []; }
    const condition = this._parseWhereClause(whereMatch[1].trim());
    this._tables.skill_eval_tasks = this._tables.skill_eval_tasks.filter(r => !condition(r));
    return [];
  }
}

// 覆盖 _handleSelect：支持 COUNT(*) 聚合
const origHandleSelect = MemoryDb.prototype._handleSelect;
MemoryDb.prototype._handleSelect = function(sql) {
  const fields = sql.match(/SELECT\s+(.+?)\s+FROM/is)?.[1]?.trim() || '';
  if (!/COUNT\(\*\)/i.test(fields)) return origHandleSelect.call(this, sql);

  const aliases = [];
  for (const f of fields.split(',')) {
    const cm = f.match(/COUNT\(\*\)\s+as\s+(\w+)/i);
    if (cm) aliases.push(cm[1].toLowerCase());
  }
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|$)/is);
  const condition = whereMatch ? this._parseWhereClause(whereMatch[1].trim()) : () => true;
  const count = this._tables.skill_eval_tasks.filter(condition).length;
  const result = {};
  for (const alias of aliases) result[alias] = String(count);
  return [result];
};

export async function createTestDb() { return new MemoryDb(); }
export async function cleanupTestDb(_db) {
  if (_db && _db._tables) _db._tables.skill_eval_tasks = [];
}
