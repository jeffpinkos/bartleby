# PostgreSQL backup and restore

Use this before relying on Bartleby for notes you want to keep. A database backup preserves all users, active and archived projects, notes, IDs, timestamps, archive flags, constraints, indexes, and the `pgmigrations` history. Markdown export is useful for reading your notes elsewhere; use the database backup to recover the application itself.

These commands use PostgreSQL 18's tools inside the existing `bartleby-db` container and its configured PostgreSQL user over a local socket. They do not expose the password from `.env`. Docker and the container must be running. Backups cover the `bartleby` database; container settings, database roles/passwords, application files, and browser preferences are separate.

## Create a backup

Run this from a terminal. It writes outside the repository, gives the backup private file permissions, and renames the file only after the dump succeeds:

```sh
(
  set -eu
  umask 077
  bartleby_backup_dir="$HOME/Documents/bartleby-backups"
  mkdir -p "$bartleby_backup_dir"
  bartleby_backup_file="$bartleby_backup_dir/bartleby-$(date -u +%Y%m%d-%H%M%S).dump"

  docker exec bartleby-db sh -c \
    'pg_dump --username="${POSTGRES_USER:-postgres}" --dbname=bartleby --no-password --format=custom' \
    > "$bartleby_backup_file.partial"
  mv "$bartleby_backup_file.partial" "$bartleby_backup_file"

  docker exec -i bartleby-db pg_restore --list < "$bartleby_backup_file"
  printf 'Backup saved: %s\n' "$bartleby_backup_file"
)
```

`pg_dump` takes a consistent snapshot while the application is running. The compressed custom format can be inspected and restored with `pg_restore`. A readable archive listing is the first check; a successful restore is the stronger check. Keep a copy on another disk or in your normal personal backup system, since a file on the same computer does not protect against losing that computer. [PostgreSQL 18 `pg_dump` documentation](https://www.postgresql.org/docs/18/app-pgdump.html)

## Restore into a separate database

Set `bartleby_backup_file` to an existing backup. Run these commands in the same terminal so the chosen database name remains available for the later checks:

```sh
bartleby_backup_file="$HOME/Documents/bartleby-backups/bartleby-YYYYMMDD-HHMMSS.dump"
bartleby_restore_db="bartleby_restore_$(date -u +%Y%m%d_%H%M%S)_${RANDOM}"

docker exec bartleby-db sh -c \
  'createdb --username="${POSTGRES_USER:-postgres}" --no-password --template=template0 "$1"' \
  sh "$bartleby_restore_db" &&
docker exec -i bartleby-db sh -c \
  'pg_restore --username="${POSTGRES_USER:-postgres}" --dbname="$1" --no-password --exit-on-error --single-transaction --no-owner --no-privileges' \
  sh "$bartleby_restore_db" < "$bartleby_backup_file"
```

Check that both commands finish successfully. The new database has a unique name, so the original `bartleby` database is preserved. The restore runs as one transaction and stops on errors; restored objects belong to the container's PostgreSQL user. If restoration fails, fix the reported problem before using the copy. [PostgreSQL 18 `pg_restore` documentation](https://www.postgresql.org/docs/18/app-pgrestore.html)

## Verify the copy

For a fresh backup, leave the application idle between creating the backup and comparing it with the original. Run the following to compare row counts and fingerprints of every stored column, including note bodies and migration records:

```sh
for bartleby_check_db in bartleby "$bartleby_restore_db"; do
  printf '\nDatabase: %s\n' "$bartleby_check_db"
  docker exec -i bartleby-db sh -c \
    'psql --username="${POSTGRES_USER:-postgres}" --dbname="$1" --no-password --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1' \
    sh "$bartleby_check_db" <<'SQL'
SET TIME ZONE 'UTC';
SELECT 'users', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) FROM public.users t
UNION ALL
SELECT 'projects', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) FROM public.projects t
UNION ALL
SELECT 'notes', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) FROM public.notes t
UNION ALL
SELECT 'pgmigrations', count(*), md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) FROM public.pgmigrations t;
SQL
done
```

Each table's count and fingerprint should match. An older backup represents its original snapshot, so changes saved since then will differ from the current database.

To inspect or recover from the copy in Bartleby, stop the application, change only the database name in `.env`'s `DATABASE_URL` to the value of `bartleby_restore_db`, then run:

```sh
nvm use
npm run db:migrate
npm run dev
```

The restored `pgmigrations` records keep previously applied migrations from running again; the migration command applies any newer migrations required by the current code. Check a note's content and dates, an archived project, and a normal save. Keep the original database and backup until you are satisfied with the recovery. The original remains available by switching `.env` back to its previous database name and restarting the application.

## Remove a verification copy

For a practice restore, first stop any application using the copy and switch `.env` back to the original database. Remove only the uniquely named restored database:

```sh
case "$bartleby_restore_db" in
  bartleby_restore_*)
    docker exec bartleby-db sh -c \
      'dropdb --username="${POSTGRES_USER:-postgres}" --no-password "$1"' \
      sh "$bartleby_restore_db"
    ;;
  *) printf 'Refusing to remove an unexpected database name.\n' ;;
esac
```

Keep the backup file. Run another restore check after important schema changes or when changing how backups are stored.
