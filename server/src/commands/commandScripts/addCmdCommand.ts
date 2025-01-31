import { Command } from "../command";
import { TextCommandsRepository } from "./../../database";
import { IUser, UserLevels } from "../../models";
import { BotContainer } from "../../inversify.config";

export default class AddCmdCommand extends Command {
    private textCommands: TextCommandsRepository;

    constructor() {
        super();

        this.textCommands = BotContainer.get(TextCommandsRepository);

        this.minimumUserLevel = UserLevels.Moderator;
    }

    public async executeInternal(channel: string, user: IUser, commandName: string, ...args: string[]): Promise<void> {
        // Remove all preceding exclamation marks if present.
        if (commandName.startsWith("!")) {
            commandName = commandName.substr(1);
        }

        let command = await this.textCommands.get(commandName);
        if (!command) {
            command = {
                commandName,
                message: args.join(" "),
                useCount: 0,
                useCooldown: true
            };

            await this.textCommands.add(command);
            await this.twitchService.sendMessage(channel, `!${commandName} has been added!`);
        } else {
            this.twitchService.sendMessage(channel, `The command !${commandName} already exists.` );
        }
    }

    public getDescription(): string {
        return `Adds a command that outputs the specified message. Usage: !addcmd <name> <message>`;
    }
}
