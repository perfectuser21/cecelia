/**
 * 测试数据库辅助函数
 * 使用内存 mock DB，无需真实 PostgreSQL 连接，CI 可直接运行
 */

/**
 * 内存 SQL 执行引擎（简单实现，支持 skill_eval_tasks 表 CRUD）
 */
class MemoryDb {
  constructor() {
    this._tables = {
      skill_eval_tasks: [],
    };
  }

  /** 执行 SQL，返回第一行，不存在时抛出 */
  async one(sql, values = []) {
    const result = await this._execute(sql, values);
    if (!result || result.length === 0) {
      throw new Error(`No data returned for: ${sql.substring(0, 80)}`);
    }
    return result[0];
  }

  /** 执行 SQL，返回第一行或 null */
  async oneOrNone(sql, values = []) {
    const result = await this._execute(sql, values);
    if (!result || result.length === 0) return null;
    return result[0];
  }

  /** 执行 SQL，无返回值 */
  async none(sql, values = []) {
    await this._execute(sql, values);
    return null;
  }

  /** 执行 SQL，返回多行 */
  async manyOrNone(sql, values = []) {
    const result = await this._execute(sql, values);
    return result || [];
  }

  /** 执行 SQL，返回多行（alias） */
  async any(sql, values = []) {
    return this.manyOrNone(sql, values);
  }

  /**
   * 内部 SQL 执行器
   * 支持 SELECT / INSERT / UPDATE / DELETE / TRUNCATE / CREATE TABLE
   */
  async _execute(sql, values = []) {
    const normalized = sql.trim().replace(/\s+/g, ' ');
    const upper = normalized.toUpperCase();

    // 替换 $1, $2, ... 占位符
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

    // CREATE TABLE IF NOT EXISTS — 忽略
    if (filledUpper.includes('CREATE TABLE')) {
      return [];
    }

    // INSERT INTO schema_version — 忽略
    if (filledUpper.includes('INSERT INTO SCHEMA_VERSION')) {
      return [];
    }

    // TRUNCATE
    if (filledUpper.startsWith('TRUNCATE')) {
      this._tables.skill_eval_tasks = [];
      return [];
    }

    // INSERT INTO skill_eval_tasks
    if (filledUpper.startsWith('INSERT INTO SKILL_EVAL_TASKS')) {
      return this._handleInsert(filled);
    }

    // UPDATE skill_eval_tasks
    if (filledUpper.startsWith('UPDATE SKILL_EVAL_TASKS')) {
      return this._handleUpdate(filled);
    }

    // SELECT
    if (filledUpper.startsWith('SELECT')) {
      return this._handleSelect(filled);
    }

    // DELETE
    if (filledUpper.startsWith('DELETE FROM SKILL_EVAL_TASKS')) {
      return this._handleDelete(filled);
    }

    return [];
  }

  _handleInsert(sql) {
    // 解析 INSERT INTO skill_eval_tasks (cols) VALUES (vals)
    const colMatch = sql.match(/\(([^)]+)\)\s+VALUES\s+(.+)/is);
    if (!colMatch) return [];

    const colsPart = colMatch[1];
    const valsPart = colMatch[2].trim();

    const cols = colsPart.split(',').map(c => c.trim().toLowerCase());

    // 支持多行 VALUES
    const valueGroups = this._parseValueGroups(valsPart);

    for (const vals of valueGroups) {
      const row = this._makeDefaultRow();
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        let val = vals[i];
        if (val === undefined || val === 'NULL' || val === 'null') {
          row[col] = null;
        } else if (/^NOW\(\)$/i.test(val)) {
          row[col] = new Date();
        } else {
          // 处理 NOW() - INTERVAL 'N seconds/minutes/hours'
          const intervalMatch = val.match(/^NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s*(seconds?|minutes?|hours?|days?)'/i);
          if (intervalMatch) {
            const amount = parseInt(intervalMatch[1]);
            const unit = intervalMatch[2].toLowerCase();
            let ms = amount * 1000;
            if (unit.startsWith('minute')) ms = amount * 60 * 1000;
            else if (unit.startsWith('hour')) ms = amount * 3600 * 1000;
            else if (unit.startsWith('day')) ms = amount * 86400 * 1000;
            row[col] = new Date(Date.now() - ms);
          } else {
            // 去掉引号
            if ((val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1).replace(/''/g, "'");
            }
            row[col] = val;
          }
        }
      }
      this._tables.skill_eval_tasks.push(row);
    }
    return [];
  }

  _parseValueGroups(valsPart) {
    const groups = [];
    let depth = 0;
    let current = '';
    let inStr = false;

    for (let i = 0; i < valsPart.length; i++) {
      const ch = valsPart[i];
      if (ch === "'" && !inStr) { inStr = true; current += ch; continue; }
      if (ch === "'" && inStr) {
        // escaped quote?
        if (valsPart[i+1] === "'") { current += "''"; i++; continue; }
        inStr = false; current += ch; continue;
      }
      if (inStr) { current += ch; continue; }

      if (ch === '(') {
        if (depth === 0) { current = ''; depth++; continue; }
        depth++; current += ch;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          groups.push(this._splitValues(current.trim()));
          current = '';
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
    }
    return groups;
  }

  _splitValues(str) {
    const vals = [];
    let depth = 0;
    let inStr = false;
    let current = '';

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && !inStr) { inStr = true; current += ch; continue; }
      if (ch === "'" && inStr) {
        if (str[i+1] === "'") { current += "''"; i++; continue; }
        inStr = false; current += ch; continue;
      }
      if (inStr) { current += ch; continue; }

      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (ch === ',' && depth === 0) {
        vals.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) vals.push(current.trim());
    return vals;
  }

  _makeDefaultRow() {
    return {
      task_id: null,
      zip_hash: null,
      zip_path: null,
      skill_name: 'unknown',
      platform: 'unknown',
      report_url: null,
      submitter: null,
      pending_reason: null,
      failure_reason: null,
      container_id: null,
      status: 'pending',
      created_at: new Date(),
      started_at: null,
      completed_at: null,
      updated_at: new Date(),
    };
  }

  _handleUpdate(sql) {
    // 解析 UPDATE skill_eval_tasks SET ... WHERE ...
    const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is);
    if (!setMatch) return [];

    const setClause = setMatch[1].trim();
    const whereClause = setMatch[2] ? setMatch[2].trim() : null;

    const assignments = this._parseSetClause(setClause);
    const condition = whereClause ? this._parseWhereClause(whereClause) : () => true;

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
    // Split by comma, but not inside strings
    const parts = [];
    let inStr = false;
    let current = '';
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
    // 支持简单的 AND 条件: col='val' AND col2='val2'
    // 也支持 col IN ('a','b','c')
    return (row) => {
      const upperWhere = where.toUpperCase();

      // 拆分 AND 条件
      const conditions = this._splitAnd(where);

      for (const cond of conditions) {
        const trimmed = cond.trim();
        const upperTrimmed = trimmed.toUpperCase();

        // task_id=$1 已在 values 替换阶段处理成 task_id='value'
        // status IN ('a','b','c')
        const inMatch = trimmed.match(/^(\w+)\s+IN\s+\((.+)\)$/i);
        if (inMatch) {
          const col = inMatch[1].toLowerCase();
          const inVals = inMatch[2].split(',').map(v => {
            v = v.trim();
            if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
            return v;
          });
          if (!inVals.includes(String(row[col] || ''))) return false;
          continue;
        }

        // col < NOW() - INTERVAL '...'
        const intervalMatch = trimmed.match(/^(\w+)\s*<\s*NOW\(\)\s*-\s*INTERVAL\s+'(\d+)\s+seconds'/i);
        if (intervalMatch) {
          const col = intervalMatch[1].toLowerCase();
          const seconds = parseInt(intervalMatch[2]);
          const threshold = new Date(Date.now() - seconds * 1000);
          const rowVal = row[col];
          if (!rowVal || new Date(rowVal) >= threshold) return false;
          continue;
        }

        // col='val' or col='val' (equality)
        const eqMatch = trimmed.match(/^(\w+)\s*=\s*'([^']*)'$/);
        if (eqMatch) {
          const col = eqMatch[1].toLowerCase();
          const val = eqMatch[2];
          if (String(row[col] || '') !== val) return false;
          continue;
        }

        // col=val (unquoted)
        const eqNumMatch = trimmed.match(/^(\w+)\s*=\s*(\S+)$/);
        if (eqNumMatch) {
          const col = eqNumMatch[1].toLowerCase();
          const val = eqNumMatch[2];
          if (String(row[col] || '') !== val) return false;
          continue;
        }
      }
      return true;
    };
  }

  _splitAnd(where) {
    // Split on AND that's not inside quotes
    const parts = [];
    let inStr = false;
    let current = '';
    let i = 0;
    while (i < where.length) {
      const ch = where[i];
      if (ch === "'") { inStr = !inStr; current += ch; i++; continue; }
      if (!inStr && where.substring(i, i+4).toUpperCase() === ' AND') {
        parts.push(current.trim());
        current = '';
        i += 4;
        continue;
      }
      current += ch;
      i++;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  _handleSelect(sql) {
    const table = this._tables.skill_eval_tasks;
    const upperSql = sql.toUpperCase();

    // Extract SELECT fields
    const fromMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+skill_eval_tasks/is);
    if (!fromMatch) return [];

    const fields = fromMatch[1].trim();

    // WHERE clause
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|$)/is);
    const condition = whereMatch ? this._parseWhereClause(whereMatch[1].trim()) : () => true;

    // ORDER BY
    const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
    let orderCol = orderMatch ? orderMatch[1].toLowerCase() : null;
    let orderDir = orderMatch && orderMatch[2] && orderMatch[2].toUpperCase() === 'DESC' ? -1 : 1;

    // LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1]) : null;

    let rows = table.filter(condition);

    if (orderCol) {
      rows = rows.slice().sort((a, b) => {
        const av = a[orderCol];
        const bv = b[orderCol];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av < bv) return -orderDir;
        if (av > bv) return orderDir;
        return 0;
      });
    }

    if (limit !== null) rows = rows.slice(0, limit);

    // Project fields
    return rows.map(row => this._project(row, fields, sql));
  }

  _project(row, fields, fullSql) {
    if (fields.trim() === '*') return { ...row };

    const result = {};
    const fieldParts = fields.split(',').map(f => f.trim());

    for (const field of fieldParts) {
      // Handle COUNT(*) as cnt, running_count, count, etc.
      const countMatch = field.match(/COUNT\(\*\)\s+as\s+(\w+)/i);
      if (countMatch) {
        // This shouldn't hit per-row, handled below
        continue;
      }

      // Handle aliases: col AS alias
      const aliasMatch = field.match(/^(\w+)\s+as\s+(\w+)$/i);
      if (aliasMatch) {
        result[aliasMatch[2].toLowerCase()] = row[aliasMatch[1].toLowerCase()];
        continue;
      }

      const col = field.toLowerCase();
      result[col] = row[col] !== undefined ? row[col] : null;
    }
    return result;
  }

  _handleDelete(sql) {
    const whereMatch = sql.match(/WHERE\s+(.+)$/is);
    if (!whereMatch) {
      this._tables.skill_eval_tasks = [];
      return [];
    }
    const condition = this._parseWhereClause(whereMatch[1].trim());
    this._tables.skill_eval_tasks = this._tables.skill_eval_tasks.filter(r => !condition(r));
    return [];
  }
}

// 覆盖 _handleSelect 来支持 COUNT(*) 聚合
const origHandleSelect = MemoryDb.prototype._handleSelect;
MemoryDb.prototype._handleSelect = function(sql) {
  const fields = sql.match(/SELECT\s+(.+?)\s+FROM/is)?.[1]?.trim() || '';
  const hasCount = /COUNT\(\*\)/i.test(fields);

  if (hasCount) {
    // 取别名列表
    const aliases = [];
    const fieldParts = fields.split(',');
    for (const f of fieldParts) {
      const cm = f.match(/COUNT\(\*\)\s+as\s+(\w+)/i);
      if (cm) aliases.push(cm[1].toLowerCase());
    }

    // 过滤
    const upperSql = sql.toUpperCase();
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|$)/is);
    const condition = whereMatch ? this._parseWhereClause(whereMatch[1].trim()) : () => true;
    const count = this._tables.skill_eval_tasks.filter(condition).length;

    const result = {};
    for (const alias of aliases) {
      result[alias] = String(count);
    }
    return [result];
  }

  return origHandleSelect.call(this, sql);
};

export async function createTestDb() {
  return new MemoryDb();
}

export async function cleanupTestDb(_db) {
  // 内存 DB 自动 GC，无需清理
  if (_db && _db._tables) {
    _db._tables.skill_eval_tasks = [];
  }
}
