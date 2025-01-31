import { Command } from "../command";
import { CommandAliasesRepository } from "./../../database";
import { IUser, UserLevels } from "../../models";
import { BotContainer } from "../../inversify.config";

export class DelAliasCommand extends Command {
    private commandAliases: CommandAliasesRepository;

    constructor() {
        super();

        this.commandAliases = BotContainer.get(CommandAliasesRepository);

        this.minimumUserLevel = UserLevels.Moderator;
    }

    public async executeInternal(channel: string, user: IUser, alias: string): Promise<void> {
        if (!alias) {
            return;
        }

        const deleted = await this.commandAliases.delete(alias);
        if (deleted) {
            await this.twitchService.sendMessage(channel, `!${alias} has been removed!`);
        }
    }

    public getDescription(): string {
        return `Deletes a command alias. Usage: !delalias <name>`;
    }
}

export default DelAliasCommand;
