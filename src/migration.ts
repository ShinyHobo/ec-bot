import Database from 'better-sqlite3';

/** The database migration helper class */
export default abstract class Migration {
    /** Runs migration scripts */
    public static run(db: Database) {
        const migrate = db.transaction(() => {
            db.prepare("CREATE TABLE IF NOT EXISTS verification (discord_id TEXT, code TEXT, UNIQUE(discord_id))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS threads(id TEXT, UNIQUE(id))").run();

            // add json data format as tables
            db.prepare("CREATE TABLE IF NOT EXISTS deliverable_diff ("+
                "id	INTEGER NOT NULL UNIQUE,"+
                "uuid TEXT,"+
                "slug TEXT,"+
                "title TEXT,"+
                "description TEXT,"+
                "startDate INTEGER,"+
                "endDate INTEGER,"+
                "updateDate	INTEGER,"+
                "addedDate INTEGER,"+
                "numberOfDisciplines INTEGER,"+
                "numberOfTeams INTEGER,"+
                "totalCount INTEGER,"+
                "card_id INTEGER,"+
                "project_ids TEXT,"+
                "PRIMARY KEY(id AUTOINCREMENT))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS team_diff("+
                "id INTEGER NOT NULL UNIQUE,"+
                "abbreviation TEXT,"+
                "title TEXT,"+
                "description TEXT,"+
                "startDate INTEGER,"+
                "endDate INTEGER,"+
                "addedDate INTEGER,"+
                "numberOfDeliverables INTEGER,"+
                "slug INTEGER,"+
                "PRIMARY KEY(id AUTOINCREMENT))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS deliverable_teams ("+
                "deliverable_id INTEGER,"+
                "team_id INTEGER,"+
                "PRIMARY KEY(deliverable_id,team_id))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS card_diff ("+
                "id INTEGER NOT NULL UNIQUE,"+
                "tid INTEGER,"+
                "title TEXT,"+
                "description TEXT,"+
                "category INTEGER,"+
                "release_id INTEGER,"+
                "release_title TEXT,"+
                "updateDate INTEGER,"+
                "addedDate INTEGER,"+
                "thumbnail TEXT,"+
                "PRIMARY KEY(id AUTOINCREMENT))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS timeAllocation_diff("+
                "id INTEGER NOT NULL UNIQUE,"+
                "startDate INTEGER,"+
                "endDate INTEGER,"+
                "addedDate INTEGER,"+
                "uuid TEXT,"+
                "partialTime INTEGER,"+
                "team_id INTEGER,"+
                "deliverable_id INTEGER,"+
                "PRIMARY KEY(id AUTOINCREMENT))").run();
        });

        migrate();
    }
}
