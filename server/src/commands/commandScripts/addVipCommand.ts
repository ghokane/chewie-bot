import { IUser, UserLevels } from "../../models/";
import { UserService } from "../../services";
import { Command } from "../command";
import { BotContainer } from "../../inversify.config";

export class AddVipCommand extends Command {
    private userService: UserService;

    constructor() {
        super();

        this.userService = BotContainer.get(UserService);

        this.minimumUserLevel = UserLevels.Broadcaster;
    }

    public async executeInternal(channel: string, user: IUser, targetUsername: string, weeks: number) {
        let targetUser = await this.userService.getUser(targetUsername);
        if (!targetUser || !weeks) {
            this.twitchService.sendMessage(channel, "Try again with !addvip <user> <weeks>");
            return;
        }

        if (!targetUser) {
            if (await this.twitchService.userExistsInChat(channel, targetUsername)) {
                targetUser = await this.userService.getUser(targetUsername);
            }
        }

        if (!targetUser) {
            this.twitchService.sendMessage(channel, `${targetUsername} is not a valid user.`);
            return;
        }

        await this.userService.addVipGoldWeeks(targetUser, weeks, `Added by ${user.username}`);
        this.twitchService.sendMessage(channel, `Added ${weeks} weeks of VIP gold to ${targetUsername}.`);
    }

    public getDescription(): string {
        return `Adds a number of gold VIP weeks to a user. Usage: !addvip <user> <weeks>`;
    }
}

export default AddVipCommand;
