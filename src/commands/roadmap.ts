import { Message } from 'discord.js';
import Database from 'better-sqlite3';
import * as https from 'https';
module.exports = {
    name: '!roadmap',
    description: 'Keeps track of roadmap changes from week to week',
    usage: 'Usage: `!roadmap [pull/compare]`',
    execute(msg: Message, args: Array<string>, db: Database) {
        if(args.length !== 1) {
            msg.reply(this.usage);
            return;
        }

        switch(args[0]) {
            case 'pull':
                this.lookup([], msg, db);
                break;
            case 'compare':
                this.compare([], msg, db);
                break;
            default:
                msg.reply(this.usage);
                break;
        }
    },
    SortByEnum: Object.freeze({
        ALPHABETICAL: "ALPHABETICAL",
        CHRONOLOGICAL: "CHRONOLOGICAL"
    }),
    CategoryEnum: Object.freeze({
        CoreTech: 1,
        Gameplay: 2,
        Characters: 3,
        Locations: 4,
        AI: 5,
        ShipsAndVehicles: 6,
        WeaponsAndItems: 7
    }),
    ProjectEnum: Object.freeze({
        SQ42: "el2codyca4mnx",
        SC: "ekm24a6ywr3o3"
    }),
    options: {
        hostname: 'robertsspaceindustries.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
    },
    async lookup(argv: Array<string>, msg: Message, db: Database) {
        msg.reply('Retrieving roadmap state...');
        let start = Date.now();
        let metaData = [];
        let data = [];
        let offset = 0;
        const sortBy = 'd' in argv ? this.SortByEnum.CHRONOLOGICAL : this.SortByEnum.ALPHABETICAL;
        do {
            const response = await this.getResponse(this.query(offset, sortBy));
            metaData = response.metaData;
            data = data.concat(metaData);
            offset += 20;
        } while(metaData.length);
        
        // only show tasks that complete in the future
        if('n' in argv) {
            const now = Date.now();
            data = data.filter(d => new Date(d.endDate).getTime() > now);
        }
        
        // only show tasks that have expired or been completed
        if('o' in argv) {
            const now = Date.now();
            data = data.filter(d => new Date(d.endDate).getTime() <= now);
        }
        
        // sort by soonest expiring
        if('e' in argv) {
            data.sort((a,b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime() || new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        }
        
        let delta = Date.now() - start;
        console.log(`Deliverables: ${data.length} in ${Math.floor(delta / 1000)} seconds`);
        const dbDate = new Date(start).toISOString().split("T")[0].replace(/-/g,'');
        db.prepare("INSERT OR REPLACE INTO roadmap (json, date) VALUES (?,?)").run([JSON.stringify(data, null, 2), dbDate]);
        msg.reply(`Roadmap retrieval returned ${data.length} deliverables in ${Math.floor(delta / 1000)} seconds. Type \`!roadmap compare\` to compare to the last update!`);
    },
    async getResponse(data) {
        return await new Promise((resolve, reject) => {
            const req = https.request(this.options, (res) => {
              let data = '';
    
              res.on('data', (d) => {
                data += d;
              });
              res.on('end', () => {
                resolve(JSON.parse(data).data.progressTracker.deliverables)
              });
            });
    
            req.on('error', (error) => {
              reject(error);
            });
    
            req.write(data);
            req.end();
        });
    },
    query(offset=0, sortBy=this.SortByEnum.ALPHABETICAL, projectSlugs=[], categoryIds=[]) {
        let query: any = {
            operationName: "deliverables",
            query: "query deliverables($startDate: String!, $endDate: String!, $search: String, $deliverableSlug: String, $teamSlug: String, $projectSlugs: [String], $categoryIds: [Int], $sortBy: SortMethod, $offset: Int, $limit: Int) {\n  progressTracker {\n    deliverables(\n      startDate: $startDate\n      endDate: $endDate\n      search: $search\n      deliverableSlug: $deliverableSlug\n      teamSlug: $teamSlug\n      projectSlugs: $projectSlugs\n      categoryIds: $categoryIds\n      sortBy: $sortBy\n      offset: $offset\n      limit: $limit\n    ) {\n      totalCount\n      metaData {\n        ...Deliverable\n        card {\n          ...Card\n          __typename\n        }\n        projects {\n          ...Project\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment Deliverable on Deliverable {\n  uuid\n  slug\n  title\n  description\n  startDate\n  endDate\n  numberOfDisciplines\n  numberOfTeams\n  updateDate\n  totalCount\n  __typename\n}\n\nfragment Card on Card {\n  id\n  title\n  description\n  category\n  release {\n    id\n    title\n    __typename\n  }\n  board {\n    id\n    title\n    __typename\n  }\n  updateDate\n  thumbnail\n  __typename\n}\n\nfragment Project on Project {\n  title\n  logo\n  __typename\n}\n",
            variables: {
                "endDate": "2023-12-31",
                "limit": 20,
                "offset": offset,
                "startDate": "2020-01-01",
                "sortBy": `${sortBy}`
            }
        };
        
        if(projectSlugs.length) {
            query.projectSlugs = JSON.stringify(projectSlugs);
        }
        
        if(categoryIds.length) {
            query.categoryIds = JSON.stringify(categoryIds);
        }
        
        return JSON.stringify(query);
    },
    compare(argv: Array<string>, msg: Message, db: Database) {
        msg.reply('Calculating difference between roadmaps...');
        const results: any = db.prepare('SELECT * FROM roadmap ORDER BY date ASC LIMIT 2').all();
        const first = JSON.parse(results[0].json);
        const last = JSON.parse(results[1].json);

        let updatedDeliverables = first.filter(f => last.some(l => l.uuid === f.uuid || l.title === f.title));
        let removedDeliverables = first.filter(f => !last.some(l => l.uuid === f.uuid || l.title === f.title));
        let newDeliverables = last.filter(l => !first.some(f => l.uuid === f.uuid || l.title === f.title));

        msg.reply('Results here:');
    }
};