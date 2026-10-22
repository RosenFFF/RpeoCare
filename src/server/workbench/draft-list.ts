import { getDraft, workbenchDb } from './store';

export interface DraftListQuery { offset: number; category: string; status: string; query: string; grouped: boolean }

/** Filter before pagination; a lost publication lease must remain visible as uncertain. */
export function queryDrafts(owner: string, repoUrl: string, query: DraftListQuery) {
  const db = workbenchDb();
  const source = `SELECT d.rowid AS position,d.id,d.state,
    CASE WHEN json_extract(d.state,'$.status')='publishing' AND NOT EXISTS
      (SELECT 1 FROM operation_locks l WHERE l.key=?||':publish:'||d.id AND l.expires>?)
      THEN 'uncertain' ELSE json_extract(d.state,'$.status') END AS effective_status
    FROM drafts d WHERE d.owner=? AND json_extract(d.state,'$.repoUrl')=?`;
  const where = `(?='all' OR json_extract(state,'$.kind')=?) AND
    ((?='archived' AND COALESCE(json_extract(state,'$.archived'),0)=1) OR
    (?!='archived' AND COALESCE(json_extract(state,'$.archived'),0)=0 AND
      (?='all' OR (?='active' AND effective_status!='published') OR effective_status=?))) AND
    instr(lower(COALESCE(json_extract(state,'$.title'),'')||' '||COALESCE(json_extract(state,'$.path'),'')||' '||COALESCE(json_extract(state,'$.number'),'')),lower(?))>0`;
  const args = [owner, Date.now(), owner, repoUrl, query.category, query.category, query.status, query.status, query.status, query.status, query.status, query.query];
  const target = `json_array(json_extract(state,'$.kind'),json_extract(state,'$.path'),json_extract(state,'$.number'),COALESCE(json_extract(state,'$.branch'),''))`;
  const cte = `WITH source AS (${source}), filtered AS (SELECT * FROM source WHERE ${where}), ranked AS
    (SELECT *,row_number() OVER(PARTITION BY ${target} ORDER BY position DESC) AS rank,
    count(*) OVER(PARTITION BY ${target}) AS siblings FROM filtered)`;
  const visible = query.grouped ? ' WHERE rank=1' : '';
  const total = (db.prepare(`${cte} SELECT count(*) AS n FROM ranked${visible}`).get(...args) as { n: number }).n;
  const offset = Math.min(query.offset, Math.max(0, Math.ceil(total / 100) - 1) * 100);
  const rows = db.prepare(`${cte} SELECT id,siblings FROM ranked${visible} ORDER BY position DESC LIMIT 100 OFFSET ?`).all(...args, offset) as { id: string; siblings: number }[];
  const projectTotal = (db.prepare("SELECT count(*) AS n FROM drafts WHERE owner=? AND json_extract(state,'$.repoUrl')=?").get(owner, repoUrl) as { n: number }).n;
  return { drafts: rows.map(row => getDraft(owner, row.id)), total, projectTotal, offset, pageSize: 100,
    hasNext: offset + rows.length < total, siblingCounts: Object.fromEntries(rows.map(row => [row.id, row.siblings])) };
}
