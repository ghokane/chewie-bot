import { injectable, inject } from "inversify";
import { UserService, TwitchWebService } from "./";
import { IUser, ITwitchUser, UserLevels} from "../models";
import * as Config from "../config.json";

/**
 * Retrieves user permissions for the broadcaster's stream from the Twitch API.
 */
@injectable()
export class UserPermissionService {
    constructor(@inject(UserService) private userService: UserService,
                @inject(TwitchWebService) private twitchWebService: TwitchWebService) {
    }

    public async updateUserLevels(user: string | IUser): Promise<void> {
        let username: string;
        let userData: IUser | undefined;

        if (typeof user === "string") {
            username = user as string;
            userData = await this.userService.getUser(username);
        } else {
            username = user.username;
            userData = user as IUser;
        }

        if (!userData) {
            return;
        }

        let newUserLevel: UserLevels;

        if (this.isUserBroadcaster(username)) {
            newUserLevel = UserLevels.Broadcaster;
        } else if (userData.userLevel < UserLevels.Admin) {
            const isModded = await this.isUserModded(username);
            if (isModded === undefined) {
                // Do not update user levels if status cannot currently be determined.
                return;
            }

            if (isModded) {
                newUserLevel = UserLevels.Moderator;
            } else if (await this.isUserSubbed(username)) {
                newUserLevel = UserLevels.Subscriber;
            } else {
                newUserLevel = UserLevels.Viewer;
            }
        } else {
            // Don't change user levels of admins based on Twitch status.
            return;
        }

        return this.updateUserLevelForUser(userData, newUserLevel);
    }

    private async updateUserLevelForUser(user: IUser, userLevel: UserLevels): Promise<void> {
        if (user.userLevel !== userLevel) {
            user.userLevel = userLevel;
            return this.userService.updateUser(user);
        }
    }

    private async isUserModded(username: string): Promise<boolean | undefined> {
        const mods = await this.twitchWebService.fetchModerators([username]);
        return mods === undefined ? undefined : mods.length > 0;
    }

    private async isUserSubbed(username: string): Promise<boolean | undefined> {
        const subs = await this.twitchWebService.fetchSubscribers([username]);
        return subs === undefined ? undefined : subs.length > 0;
    }

    private isUserBroadcaster(username: string): boolean {
        return username === Config.twitch.broadcasterName;
    }
}

export default UserPermissionService;
