import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

/** Class containing RSI network and query related properties */
export default abstract class RSINetwork {
    /** The available search pattens for the graphql queries */
    public static readonly SortByEnum = Object.freeze({
        ALPHABETICAL: "ALPHABETICAL",
        CHRONOLOGICAL: "CHRONOLOGICAL"
    });

    /** The available category ids for the graphql queries */
    public static readonly CategoryEnum = Object.freeze({
        CoreTech: 1,
        Gameplay: 2,
        Characters: 3,
        Locations: 4,
        AI: 5,
        ShipsAndVehicles: 6,
        WeaponsAndItems: 7
    });

    /** The available query types */
    public static readonly QueryTypeEnum = Object.freeze({
        Deliverables: 1,
        Teams: 2,
        Disciplines: 3
    });

    /** The available project types for the graphql queries */
    public static readonly ProjectEnum = Object.freeze({
        SQ42: "el2codyca4mnx",
        SC: "ekm24a6ywr3o3"
    });

    /** The available project images */
    public static readonly ProjectImages = Object.freeze({
        SQ42: "/media/b9ka4ohfxyb1kr/source/StarCitizen_Square_LargeTrademark_White_Transparent.png",
        SC: "/media/z2vo2a613vja6r/source/Squadron42_White_Reserved_Transparent.png" 
    });

    /** Graphql query for retrieving the list of deliverables from the RSI progress tracker page */
    private static readonly deliverablesGraphql = fs.readFileSync(path.join(__dirname, '..', 'graphql', 'deliverables.graphql'), 'utf-8');

    /** Graphql query for retrieving the list of teams and time allocations from the RSI progress tracker page */
    private static readonly teamsGraphql = fs.readFileSync(path.join(__dirname, '..', 'graphql', 'teams.graphql'), 'utf-8');

    /** Graphql query for retrieving the list of team disciplines and time allocations from the RSI progress tracker page */
    private static readonly disciplinesGraphql = fs.readFileSync(path.join(__dirname, '..', 'graphql', 'disciplines.graphql'), 'utf-8');

    /** RSI hostname */
    public static readonly rsi = 'robertsspaceindustries.com';

    /** The base query options for pulling down graphql results */
    private static readonly options = {
        hostname: this.rsi,
        path: '/graphql',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
    };

    /**
     * Gets data from RSI
     * @param data The graphql query
     * @param type The grpahql query type
     * @returns The response promise
     */
    public static async getResponse(data: string, type: number): Promise<any> {
        return await new Promise((resolve, reject) => { // TODO - Refactor code to require only a singe variable
            const req = https.request(this.options, (res) => {
              let returnData = '';

              res.on('data', (d) => {
                returnData += d;
              });
              res.on('end', () => {
                if(returnData[0] === '<') {
                    console.log(returnData);
                    reject('Server error');
                }
                try {
                    switch(type){
                        case 1: // Deliverables
                            resolve(JSON.parse(returnData).data.progressTracker.deliverables);
                            break;
                        case 2: // Teams
                            resolve(JSON.parse(returnData).data.progressTracker.teams);
                            break;
                        case 3: // Disciplines
                            resolve(JSON.parse(returnData).data.progressTracker.disciplines);
                        default:
                            reject(`Invalid response query type ${type}`);
                            break;
                    }
                } catch(e) {
                    // RSI is under heavy load right now, sorry!
                    reject('');
                }
              });
            });

            req.on('error', (error) => {
              reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject('timed out');
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Generates a graphql query for retrieving deliverables data from RSI
     * @param offset The offset
     * @param limit The limit (max 20)
     * @param sortBy SortByEnum sort type
     * @param projectSlugs The projects to limit the search to
     * @param categoryIds The categories to limit the search to
     * @returns The query
     */
    public static deliverablesQuery(offset: number =0, limit: number=20, sortBy:string=this.SortByEnum.ALPHABETICAL, projectSlugs:any[]=[], categoryIds:any[]=[]): string {
        const query: any = {
            operationName: "deliverables",
            query: this.deliverablesGraphql,
            variables: {
                "startDate": "2020-01-01",
                "endDate": "2023-12-31",
                "limit": limit,
                "offset": offset,
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
    }

    /**
     * Generates a graphql query for retrieving teams data from RSI
     * @param offset The offset
     * @param deliverableSlug The deliverable slug to limit the search by
     * @param sortBy SortByEnum sort type
     * @returns The query
     */
    public static teamsQuery(offset: number =0, deliverableSlug: string, sortBy=this.SortByEnum.ALPHABETICAL) {
        const query: any = {
            operationName: "teams",
            query: this.teamsGraphql,
            variables: {
                "startDate": "2020-01-01",
                "endDate": "2050-12-31",
                "limit": 20,
                "offset": offset,
                "sortBy": `${sortBy}`,
                "deliverableSlug": deliverableSlug,
            }
        };

        return JSON.stringify(query);
    }

    /**
     * Generates a graphql query for retrieving disciplines data from RSI
     * @param teamSlug The team slug
     * @param deliverableSlug The deliverable slug
     * @returns The query
     */
    public static disciplinesQuery(teamSlug: string, deliverableSlug: string) {
        const query: any = {
            operationName: "disciplines",
            query: this.disciplinesGraphql,
            variables: {
                "startDate": "2020-01-01",
                "endDate": "2050-12-31",
                "teamSlug": teamSlug,
                "deliverableSlug": deliverableSlug
            }
        };

        return JSON.stringify(query);
    }
}