import { inject, injectable } from "inversify";
import moment = require("moment");
import { InvalidSongUrlError, SongAlreadyInQueueError } from "../errors";
import { Logger, LogType } from "../logger";
import { AchievementType, EventLogType, ISong, IUser, RequestSource, SocketMessageType, SongSource } from "../models";
import SpotifyService from "./spotifyService";
import WebsocketService from "./websocketService";
import { YoutubeService } from "./youtubeService";
import { EventLogService } from "./eventLogService";
import EventAggregator from "./eventAggregator";
import UserService from "./userService";

@injectable()
export class SongService {
    private songQueue: ISong[] = [];
    private nextSongId: number = 1;

    constructor(
        @inject(YoutubeService) private youtubeService: YoutubeService,
        @inject(SpotifyService) private spotifyService: SpotifyService,
        @inject(WebsocketService) private websocketService: WebsocketService,
        @inject(EventLogService) private eventLogService: EventLogService,
        @inject(EventAggregator) private eventAggregator: EventAggregator,
        @inject(UserService) private userService: UserService,
    ) {
        //
    }

    /**
     * Helper function to test whether an object implements the ISong interface.
     * @param obj The object to test.
     */
    private isSong(obj: any): obj is ISong {
        return "id" in obj && "title" in obj && "requestedBy" in obj && "source" in obj;
    }

    /**
     * Parses a URL to get the video source and ID. This is used in API calls to get details about the video.
     * @param {string} url Video URL to parse
     */
    private parseUrl(url: string): ISong {
        // https://www.youtube.com/watch?v=l0qWjHP1GQc&list=RDl0qWjHP1GQc&start_radio=1

        const song: ISong = {} as ISong;
        const fullurl = /^https?:\/\//i.test(url) ? url: "https://" + url;

        const id = this.youtubeService.parseYoutubeUrl(fullurl);
        if (id) {
            song.source = SongSource.Youtube;
            song.sourceId = id;
        } else {
            const sid = this.spotifyService.parseSpotifyUrl(fullurl);
            if (sid) {
                song.source = SongSource.Spotify;
                song.sourceId = sid;
            } else {
                // Not a youtube url. Parse other urls in future
                throw new InvalidSongUrlError("URL is not a valid YouTube URL.");
            }
        }

        song.id = this.nextSongId++;
        song.sourceUrl = fullurl;
        return song;
    }

    /**
     * Get details for a song from the songs source API (Youtube, Spotify, etc).
     * @param song The song to get details for.
     */
    private async getSongDetails(song: ISong): Promise<ISong> {
        switch (song.source) {
            case SongSource.Youtube: {
                const songDetails = await this.youtubeService.getSongDetails(song.sourceId);
                if (songDetails) {
                    song.details = {
                        title: songDetails.snippet.title,
                        duration: this.youtubeService.getSongDuration(songDetails),
                        sourceId: song.sourceId,
                        source: song.source,
                    };
                    song.previewData = {
                        linkUrl: song.sourceUrl,
                        previewUrl: this.youtubeService.getSongPreviewUrl(songDetails),
                    };
                } else {
                    throw new InvalidSongUrlError("Song details could not be loaded.");
                }
                break;
            }
            case SongSource.Spotify: {
                const songDetails = await this.spotifyService.getSongDetails(song.sourceId);
                if (songDetails) {
                    song.details = {
                        title: songDetails.name,
                        duration: this.spotifyService.getSongDuration(songDetails),
                        sourceId: song.sourceId,
                        source: song.source,
                    };
                    song.previewData = {
                        linkUrl: song.sourceUrl,
                        previewUrl: this.spotifyService.getSongPreviewUrl(songDetails),
                    };
                } else {
                    throw new InvalidSongUrlError("Song details could not be loaded.");
                }
                break;
            }
        }
        return song;
    }

    /**
     * Add a song to the song queue.
     * @param url The url of the song to add to the queue.
     * @param requestSource The source of the request (Donation, Bits, Subscription, Raffle).
     * @param username The username that is requesting the song to be added.
     * @param comments Additional comments/instructions for the song
     */
    public async addSong(url: string, requestSource: RequestSource, username: string, comments: string): Promise<ISong> {
        try {
            let song = this.parseUrl(url);

            const existingSong = Object.values(this.songQueue).filter((s) => {
                return s.sourceId === song.sourceId && s.source === song.source;
            })[0];

            if (existingSong) {
                throw new SongAlreadyInQueueError("Song has already been added to the queue.");
            }

            song = await this.getSongDetails(song);
            this.songQueue.push(song);
            Logger.info(LogType.Song, `${song.source}:${song.sourceId} added to Song Queue`);
            song.requestedBy = username;
            song.requestSource = requestSource;
            song.requestTime = moment.now();
            song.comments = comments;

            this.websocketService.send({
                type: SocketMessageType.SongAdded,
                message: "Song Added",
                data: song,
                username,
            });

            await this.eventLogService.addSongRequest(username, {
                message: "Song was requested.",
                song: {
                    title: song.details.title,
                    requestedBy: song.requestedBy,
                    requestSource: song.requestSource,
                    songSource: song.source,
                    url,
                },
            });

            const user = await this.userService.getUser(username);
            if (user) {
                const count = await this.eventLogService.getCount(EventLogType.SongRequest, username);
                this.eventAggregator.publishAchievement({ user, type: AchievementType.SongRequests, count });
            }

            return song;
        } catch (err) {
            if (err instanceof InvalidSongUrlError) {
                Logger.info(LogType.Song, `${url} is an invalid song url.`);
                throw err;
            } else {
                throw err;
            }
        }
    }

    /**
     * Adds a song to the queue using a gold song request.
     * @param url URL to the song
     * @param user User who requested
     * @returns Error message or result song
     */
    public async addGoldSong(url: string, user: IUser, comments: string): Promise<string|ISong> {
        // Check if user has gold status
        if (!user.vipExpiry && !user.vipPermanentRequests) {
            return `${user.username}, you need VIP gold status to request a song. Check !vipgold for details.`;
        }

        const todayDate = new Date(new Date().toDateString());

        // Check if gold status has expired (expiration date is inclusive).
        if (!user.vipPermanentRequests && user.vipExpiry) {
            if (user.vipExpiry < todayDate) {
                return `${user.username}, your VIP gold status expired on ${user.vipExpiry.toDateString()}.`;
            }
        }

        // Check if gold song has been used this week.
        if (user.vipLastRequest && user.vipExpiry) {
            const startOfWeek = this.getIndividualStartOfWeek(todayDate, user.vipExpiry);
            if (user.vipLastRequest >= startOfWeek) {
                return `Sorry ${user.username}, you already had a gold song request this week.`;
            }
        }

        const song = await this.addSong(url, RequestSource.GoldSong, user.username, comments);
        user.vipLastRequest = todayDate;

        // Any gold song used will always reduce the amount of permanent requests left.
        // Adding a permanent request will also extend the VIP period, so no request will be lost.
        if (user.vipPermanentRequests) {
            user.vipPermanentRequests--;
        }

        this.userService.updateUser(user);
        return song;
    }

    /**
     * Set a song in the queue to Played status.
     * @param song The song or song id to update.
     */
    public songPlayed(song: ISong | number): void;
    public songPlayed(song: any): void {
        if (typeof song === "number") {
            const songToChange =
                this.songQueue.filter((item) => {
                    return item.id === song;
                })[0] || undefined;
            if (songToChange) {
                const songIndex = this.songQueue.indexOf(songToChange);
                const songData = this.songQueue[songIndex];
                this.songQueue.splice(songIndex, 1);

                this.eventLogService.addSongPlayed(songData.requestedBy, {
                    message: "Song has been played.",
                    song: songData,
                });
                this.websocketService.send({
                    type: SocketMessageType.SongPlayed,
                    message: "Song Played",
                    data: songData,
                });
            }
        } else if (typeof song === "object" && song.type === "isong") {
            const songData =
                this.songQueue.filter((item) => {
                    return item.id === song.id;
                })[0] || undefined;
            if (songData) {
                const songIndex = this.songQueue.indexOf(songData);
                this.songQueue.splice(songIndex, 1);

                this.eventLogService.addSongPlayed(song.requestedBy, {
                    message: "Song has been played.",
                    song,
                });
                this.websocketService.send({
                    type: SocketMessageType.SongPlayed,
                    message: "Song Played",
                    data: song,
                });
            }
        }
    }

    /**
     * Moves a song to the top of the song queue.
     * @param song The song or song id to remove.
     */
    public moveSongToTop(song: ISong | number): void;
    public moveSongToTop(song: any): void {
        if (typeof song === "number") {
            const songToMove =
                this.songQueue.filter((item) => {
                    return item.id === song;
                })[0] || undefined;
            if (songToMove) {
                const songIndex = this.songQueue.indexOf(songToMove);
                this.songQueue.splice(songIndex, 1);
                this.songQueue.splice(0, 0, songToMove);

                this.websocketService.send({
                    type: SocketMessageType.SongMovedToTop,
                    message: "Song moved to top",
                    data: songToMove,
                });
            }
        } else if (this.isSong(song)) {
            const songData =
                this.songQueue.filter((item) => {
                    return item.id === song.id;
                })[0] || undefined;
            if (songData) {
                const index = this.songQueue.indexOf(songData);
                this.songQueue.splice(index, 1);
                this.songQueue.splice(0, 0, song);

                this.websocketService.send({
                    type: SocketMessageType.SongMovedToTop,
                    message: "Song moved to top",
                    data: song,
                });
            }
        }
    }

    /**
     * Remove a song from the song queue.
     * @param song The song or song id to remove.
     */
    public removeSong(song: ISong | number): void;
    public removeSong(song: any): void {
        if (typeof song === "number") {
            const songToDelete =
                this.songQueue.filter((item) => {
                    return item.id === song;
                })[0] || undefined;
            if (songToDelete) {
                const songIndex = this.songQueue.indexOf(songToDelete);
                const songData = this.songQueue[songIndex];
                this.songQueue.splice(songIndex, 1);

                this.eventLogService.addSongRemoved(songData.requestedBy, {
                    message: "Song has been removed from request queue.",
                    song: {
                        title: songData.details.title,
                        requestedBy: songData.requestedBy,
                    },
                });

                this.websocketService.send({
                    type: SocketMessageType.SongRemoved,
                    message: "Song Removed",
                    data: songData,
                });
            }
        } else if (this.isSong(song)) {
            const songData =
                this.songQueue.filter((item) => {
                    return item.id === song.id;
                })[0] || undefined;
            if (songData) {
                const index = this.songQueue.indexOf(songData);
                this.songQueue.splice(index, 1);

                this.eventLogService.addSongRemoved(song.requestedBy, {
                    message: "Song has been removed from request queue.",
                    song: {
                        title: song.details.title,
                        requestedBy: song.requestedBy,
                    },
                });
                this.websocketService.send({
                    type: SocketMessageType.SongRemoved,
                    message: "Song Removed",
                    data: song,
                });
            }
        }
    }

    /**
     * Get the list of songs in the song queue.
     */
    public getSongQueue(): ISong[] {
        return this.songQueue;
    }

    /**
     * Get the list of songs in the song queue requested by a specific user.
     * @param username The user to get the list of songs for.
     */
    public getSongsByUsername(username: string): ISong[] {
        const userSongs = Object.values(this.songQueue).filter((song) => {
            return song.requestedBy === username;
        });
        return userSongs;
    }

    private getDayStartingAtMonday(date: Date): number {
        const day = date.getDay();
        return day === 0 ? 6 : day -1;
    }

    /**
     * Determines the start of the week based on the individual VIP expiry date.
     * If VIP expires on Friday (inclusive), the next VIP week starts on Saturday.
     * @param dateToCheck Day when the request is being made (should be today)
     * @param vipExpiry Day when VIP expires
     * @returns Start of the current VIP week. Within result and dateToCheck, only one VIP request is allowed.
     */
    private getIndividualStartOfWeek(dateToCheck: Date, vipExpiry: Date) {
        // Make copy
        vipExpiry = new Date(vipExpiry);

        // Determine week start day based on VIP expiry (VIP weekday + 1)
        vipExpiry.setDate(vipExpiry.getDate() + 1);
        const vipWeekday = this.getDayStartingAtMonday(vipExpiry);

        const todayWeekday = this.getDayStartingAtMonday(dateToCheck);
        const dayDifference = todayWeekday - vipWeekday;
        const weekStartDay = new Date(new Date(dateToCheck).setDate(dateToCheck.getDate() - dayDifference));

        if (weekStartDay > dateToCheck)  {
            // Date for this weekday is in the future, use last week instead.
            weekStartDay.setDate(weekStartDay.getDate() - 7);
            return weekStartDay;
        } else {
            return weekStartDay;
        }
    }
}

export default SongService;
