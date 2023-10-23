import * as _ from 'lodash';

/** General helper function collection */
export default abstract class GeneralHelpers {
    /** The days of the week in 3 character format */
    private static shortDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    /** The days of the week in long format */
    private static longDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    /** The months of the year in 3 character format */
    private static shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    /** The months of the year in long format */
    private static longMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    /** The available project icons */
    public static readonly ProjectIcons = Object.freeze({
        SQ42: ":SQ:",
        SC: ":SC:"
    });
    
    /**
     * The YYYYMMDD or YYYY-MM-DD date to convert
     * @param date The date to convert
     * @returns The date as an epoch timestamp in ms
     */
    public static convertDateToTime(date: string): number {
        date = date.replace(/-/g,'');
        const year = +date.substring(0, 4);
        const month = +date.substring(4, 6);
        const day = +date.substring(6, 8);
        return new Date(year, month - 1, day).getTime();
    }

    /**
     * Converts time in milliseconds to a date string in YYYY-MM-DD format
     * @param time The time in milliseconds to convert
     * @param hyphenate Whether to include hyphens, defaults true
     * @returns The date string in YYYY-MM-DD format
     */
    public static convertTimeToHyphenatedDate(time: number, hyphenate: boolean = true): string {
        const date = new Date(time);
        const year = date.getFullYear();
        const month = ("0" + (date.getMonth() + 1)).slice(-2);
        const day = ("0" + date.getDate()).slice(-2);
        return `${year}${hyphenate?'-':''}${month}${hyphenate?'-':''}${day}`;
    }

    /**
     * Converts time in milliseconds to a date string in D MMMM YYYY format
     * @param time The time in milliseconds to convert
     * @returns The date string in D MMMM YYYY format
     */
    public static convertTimeToSummaryDate(time: number): string {
        const date = new Date(time);
        const year = date.getUTCFullYear();
        const month = this.longMonths[date.getUTCMonth()];
        const day = date.getUTCDate().toString();
        return `${day} ${month} ${year}`;
    }

    /**
     * Converts the time in milliseconds to a UTC date string in RSI query format
     * @param time The time in milliseconds to convert
     * @returns The date string in DDD, dd MMM YYYY hh:mm:ss +0000 format
     */
    public static convertTimeToFullDate(time: number): string {
        const date = new Date(time);
        const year = date.getUTCFullYear();
        const month = this.shortMonths[date.getUTCMonth()];
        const dayNumber = date.getUTCDate().toString().padStart(2, '0');
        const day = this.shortDays[date.getUTCDay()];
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        return `${day}, ${dayNumber} ${month} ${year} ${hours}:${minutes}:${seconds} +0000`;
    }

    /**
     * Converts milliseconds to the closest whole number
     * @param ms The time value to convert
     * @returns The absolute number of days, rounded to the nearest integer
     */
    public static convertMillisecondsToDays(ms: number): number {
        return Math.round(Math.abs(ms) / (60*60*24*1000));
    }

    /**
     * Gets the week for the given date
     * @param date The date to get the week of
     * @param firstOfYear The first day of the year
     * @returns The week of the year
     */
    public static getWeek(date: Date, firstOfYear: Date): number { 
        return Math.ceil((((date.getTime() - firstOfYear.getTime()) / 86400000) + firstOfYear.getDay() + 1) / 7);
    }

    /**
     * Merges schedule block date ranges that end and begin on the same day
     * @param ranges The date ranges to merge
     * @returns The merged date ranges
     */
    public static mergeDateRanges(ranges) {
        if(!ranges) {
            return [];
        }
        ranges = ranges.sort((a,b) => a.startDate - b.startDate);

        let returnRanges = [];
        let currentRange = null;
        ranges.forEach((r) => {
            // bypass invalid value
            if (r.startDate >= r.endDate) {
                return;
            }
            //fill in the first element
            if (!currentRange) {
                currentRange = r;
                return;
            }

            const currentEndDate = new Date(currentRange.endDate);
            currentEndDate.setDate(currentEndDate.getDate() + 4); // covers time overlap when sprint ends on a weekend
            const currentEndTime = currentEndDate.getTime();

            if (currentEndTime < r.startDate) {
                returnRanges.push(currentRange);
                currentRange = r;
            } else if (currentRange.endDate < r.endDate) {
                currentRange.endDate = r.endDate;
                currentRange.partTime = typeof currentRange.partTime == 'number' ? currentRange.partTime : 0;
                currentRange.fullTime = typeof currentRange.fullTime == 'number' ? currentRange.fullTime : 0;
                currentRange.partTime += r.partialTime;
                currentRange.fullTime += Math.abs(1 - r.partialTime);
            }
        });

        if(currentRange) {
            returnRanges.push(currentRange);
        }

        return returnRanges;
    }

    /**
     * Generates YAML frontmatter for use on a Jekyll website
     * @param date The date the report is for
     * @param category The category of the post (should be a ReportCategoryEnum)
     * @param title The title text
     * @param excerpt The excerpt text
     * @returns The YAML frontmatter
     */
    public static generateFrontmatter(date: string, category: string, title: string, excerpt: string = null): string[] {
        let frontmatter = ['---  \n','layout: post  \n',`title: "${title} - ${date}"  \n`,`date: ${date}  \n`,`categories: ${category}  \n`];
        if(excerpt) {
            frontmatter.push(`excerpt: "${excerpt}"  \n`);
        }
        frontmatter.push('---  \n  \n');
        return frontmatter;
    }

    /**
     * Shortens text to 100 characters per line for discord display
     * @param text The text to shorten
     * @returns The shortened text
     */ 
    public static shortenText(text): string {
        return `${text.replace(/(?![^\n]{1,100}$)([^\n]{1,100})\s/g, '$1\n')}  \n`.toString();
    }

    /**
     * Gets the approriate SC subreddit discord icons for the given deliverable
     * @param deliverable The deliverable
     * @returns The icon codes as a string
     */
    public static getProjectIcons(deliverable: any): string {
        let projectIcons = "";
        if(deliverable.project_ids) {
            deliverable.project_ids.split(',').forEach(p => {
                projectIcons += `${this.ProjectIcons[p]} `;
            });
        }
        return projectIcons;
    }
}