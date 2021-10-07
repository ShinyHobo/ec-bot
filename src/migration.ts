import Database from 'better-sqlite3';

/** The database migration helper class */
export default abstract class Migration {
    /** Runs migration scripts */
    public static run(db: Database) {
        db.prepare("CREATE TABLE IF NOT EXISTS verification (discord_id TEXT, code TEXT, UNIQUE(discord_id))").run();
        db.prepare("CREATE TABLE IF NOT EXISTS threads(id TEXT, UNIQUE(id))").run();
        db.prepare("CREATE TABLE IF NOT EXISTS roadmap(json TEXT, date INTEGER, PRIMARY KEY(date))").run();
    }
}
