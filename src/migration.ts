import Database from 'better-sqlite3';

/** The database migration helper class */
export default abstract class Migration {
    /** Runs migration scripts */
    public static run(db: Database) {
        const migrate = db.transaction(() => {
            db.prepare("CREATE TABLE IF NOT EXISTS verification (discord_id TEXT, code TEXT, UNIQUE(discord_id))").run();
            db.prepare("CREATE TABLE IF NOT EXISTS threads(id TEXT, UNIQUE(id))").run();

            if(false) { // debug reset
                db.prepare("DROP TABLE IF EXISTS deliverable_diff").run();
                db.prepare("DROP TABLE IF EXISTS team_diff").run();
                db.prepare("DROP TABLE IF EXISTS deliverable_teams").run();
                db.prepare("DROP TABLE IF EXISTS card_diff").run();
                db.prepare("DROP TABLE IF EXISTS timeAllocation_diff").run();
                db.prepare("DROP TABLE IF EXISTS discipline_diff").run();
            }

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

            // Fix dates in team_diff table
            const teamsWithWrongDates = db.prepare("SELECT id, startDate, endDate FROM team_diff WHERE startDate LIKE '%+0000' OR endDate LIKE '%+0000'").all();
            teamsWithWrongDates.forEach(t => {
                db.prepare(`UPDATE team_diff SET startDate = ${Date.parse(t.startDate)}, endDate = ${Date.parse(t.endDate)} WHERE id = ${t.id}`).run();
            });

            // Add discipline tracking
            db.prepare("CREATE TABLE IF NOT EXISTS discipline_diff("+
                "id INTEGER NOT NULL UNIQUE,"+
                "numberOfMembers INTEGER,"+
                "title TEXT,"+
                "uuid TEXT,"+
                "addedDate INTEGER,"+
                "PRIMARY KEY(id AUTOINCREMENT));").run();

            const disciplineIdExists = db.prepare("SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'timeAllocation_diff' AND sql LIKE '%discipline_id%'").get();
            if(!disciplineIdExists) {
                db.prepare("ALTER TABLE timeAllocation_diff ADD COLUMN discipline_id INTEGER").run();
            }

            // Remove duplicate entries, keeping lowest index
            //db.prepare("DELETE FROM timeAllocation_diff WHERE id NOT IN (SELECT min(id) FROM timeAllocation_diff GROUP BY startDate, endDate, uuid, partialTime, team_id, deliverable_id, discipline_id)").run();
        });

        migrate();
        
        // Cleans up the database by creating a temp copy and replacing
        //db.prepare("VACUUM").run();
    }
}
