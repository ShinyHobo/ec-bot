import { Message, Util, MessageAttachment } from 'discord.js';
import Database from 'better-sqlite3';
import * as https from 'https';
import * as diff from 'recursive-diff';
import * as he from 'he';
import * as _ from 'lodash';
module.exports = {
    name: '!roadmap',
    description: 'Keeps track of roadmap changes from week to week. Pull the latest version of the roadmap for today or to compare the latest pull to the previous.',
    usage: 'Usage: `!roadmap [pull/compare]`',
    execute(msg: Message, args: Array<string>, db: Database) {
        if(args.length !== 1) {
            msg.channel.send(this.usage).catch(console.error);
            return;
        }

        // const officer = msg.guild.roles.cache.find(role => role.name === 'Officer');
        // if(officer && !msg.member.roles.highest.comparePositionTo(officer)) {
        //     // inufficient privileges
        //     return;
        // }

        switch(args[0]) {
            case 'pull':
                this.lookup([], msg, db);
                break;
            case 'compare':
                this.compare([], msg, db);
                break;
            default:
                msg.channel.send(this.usage).catch(console.error);
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
        msg.channel.send('Retrieving roadmap state...').catch(console.error);
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
        const existingRoadmap: any = db.prepare('SELECT * FROM roadmap ORDER BY date DESC').get();
        const newRoadmap = JSON.stringify(data, null, 2)

        let insert = !existingRoadmap;
        
        if(existingRoadmap) {
            insert = !_.isEqual(existingRoadmap.json, newRoadmap);
        }

        if(insert) {
            db.prepare("INSERT OR REPLACE INTO roadmap (json, date) VALUES (?,?)").run([newRoadmap, dbDate]);
            msg.channel.send(`Roadmap retrieval returned ${data.length} deliverables in ${Math.floor(delta / 1000)} seconds. Type \`!roadmap compare\` to compare to the last update!`).catch(console.error);
            this.compare([], msg, db);
        } else {
            msg.channel.send('No changes have been detected since the last pull.').catch(console.error);
        }
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
        // TODO add start/end filter
        msg.channel.send('Calculating differences between roadmaps...').catch(console.error);
        const results: any = db.prepare('SELECT * FROM roadmap ORDER BY date DESC LIMIT 2').all();
        if(!results || results.length < 2) {
            msg.channel.send('More than one roadmap snapshot is needed to compare. Pull and try again later.').catch(console.error);
            return;
        }
        const first = JSON.parse(results[1].json);
        const last = JSON.parse(results[0].json);

        let messages = [];
        
        const removedDeliverables = first.filter(f => !last.some(l => l.uuid === f.uuid || l.title === f.title));
        if(removedDeliverables.length) {
            messages.push(`[${removedDeliverables.length}] deliverable(s) *removed*:\n`);
            removedDeliverables.forEach(d => {
                messages.push(he.unescape(`\* ${d.title}\n`.toString()))
                messages.push(he.unescape(this.shortenText(`${d.description}\n`)));
            });
            messages.push('===================================================================================================\n\n');
        }

        const newDeliverables = last.filter(l => !first.some(f => l.uuid === f.uuid || l.title === f.title));
        if(newDeliverables.length) {
            messages.push(`[${newDeliverables.length}] deliverable(s) *added*:\n`);
            newDeliverables.forEach(d => {
                const start = new Date(d.startDate).toDateString();
                const end = new Date(d.endDate).toDateString();
                messages.push(he.unescape(`\* **${d.title}**\n`.toString()));
                messages.push(he.unescape(`${start} => ${end}\n`.toString()));
                messages.push(he.unescape(this.shortenText(`${d.description}\n`)));
            });
            messages.push('===================================================================================================\n\n');
        }

        const updatedDeliverables = first.filter(f => last.some(l => l.uuid === f.uuid || l.title === f.title));
        if(updatedDeliverables.length) {
            let updatedMessages = [];
            let updateCount = 0;
            updatedDeliverables.forEach(f => {
                const l = last.find(x => x.uuid === f.uuid || x.title === f.uuid);
                const d = diff.getDiff(f, l);
                if(d.length) {
                    const changes = d.map(x => ({change: x.path && x.path[0], val: x.val}));
                    if(changes.some(p => p.change === 'endDate' || p.change === 'title' || p.change === 'description')) {
                        const title = f.title === 'Unannounced' ? `${f.title} (${f.description})` : f.title;
                        let update = `\* **${title}**\n`;
                        if(changes.some(p => p.change === 'endDate')) {
                            const oldDate = new Date(f.endDate).toDateString();
                            const newDate = new Date(l.endDate).toDateString();
                            update += `End date has shifted from ${oldDate} to ${newDate}\n`;
                        }
                        if(changes.some(p => p.change === 'title')) {
                            update += this.shortenText(`Title has been updated from "${f.title}" to "${l.title}"`);
                        }
                        if(changes.some(p => p.change === 'description')) {
                            update += this.shortenText(`Description has been updated from\n"${f.description}"\nto\n"${l.description}"`);
                        }
                        updatedMessages.push(he.unescape(update + '\n'));
                        updateCount++;
                    }
                }
            });
            messages.push(`[${updateCount}] deliverable(s) *updated*:\n`);
            messages = messages.concat(updatedMessages);
            messages.push(`[${updatedDeliverables.length - updateCount}] deliverable(s) *unchanged*`);
        }

        msg.channel.send({files: [new MessageAttachment(Buffer.from(messages.join(''), "utf-8"), `roadmap_${results[0].date}.md`)]}).catch(console.error);

        // Util.splitMessage(messages.join(''), {maxLength: 2000, char: '\n'}).forEach(message => {
        //     msg.channel.send(message);
        // });
    },
    shortenText(text) {
        return `${text.replace(/(?![^\n]{1,100}$)([^\n]{1,100})\s/g, '$1\n')}\n`.toString();
    }
};