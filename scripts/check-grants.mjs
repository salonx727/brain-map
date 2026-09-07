import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const r = await client.query(`
  select p.proname, p.prosecdef, r.rolname as owner, p.proacl
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.proname in ('publish_canonical_snapshot','record_sync_failure');
`);
console.log(JSON.stringify(r.rows, null, 2));
const roleCheck = await client.query(`select rolname, rolsuper, rolbypassrls, rolinherit from pg_roles where rolname in ('anon','authenticated','service_role','postgres','authenticator');`);
console.log(JSON.stringify(roleCheck.rows, null, 2));
await client.end();
