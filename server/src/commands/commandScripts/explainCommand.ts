import { Command } from "../command";
import { IUser } from "../../models";

import { BotContainer } from "../../inversify.config";
import { CommandAliasesRepository, TextCommandsRepository } from "../../database";

export default class ExplainCommand extends Command {
    private commandAliasRepository: CommandAliasesRepository;
    private textCommandsRepository: TextCommandsRepository;

    constructor() {
        super();

        this.description = "Gets the description of a command.";
        this.commandAliasRepository = BotContainer.get(CommandAliasesRepository);
        this.textCommandsRepository = BotContainer.get(TextCommandsRepository);
    }

    public async executeInternal(channel: string, user: IUser, command: string): Promise<void> {
        // Remove ! if it's at the start of the command.
        if (command[0] === "!") {
            command = command.substring(1);
        }

        // If empty, just return
        if (!command) {
            return;
        }

        // If this is an alias, update the command name to be the actual command
        // so that we can get the description
        var commandNameIfAlias = await this.getAliasCommandName(command);
        if (commandNameIfAlias) {
            command = commandNameIfAlias;
        }

        // Get the command if it exists.
        const commandList = BotContainer.get<Map<string, Command>>("Commands");
        if (commandList.has(command)) {
            const commandObject = commandList.get(command);
            if (commandObject && commandObject.getDescription().length > 0) {
                this.twitchService.sendMessage(channel, `${command}: ${commandObject.getDescription()}`);
                return;
            }
        }

        const textCommand = await this.textCommandsRepository.get(command);
        if (textCommand) {
            this.twitchService.sendMessage(channel, `${command}: Outputs \"${textCommand.message}\". Used ${textCommand.useCount} times. Has cooldown: ${textCommand.useCooldown ? "Yes" : "No"}`);
            return;
        }

        this.twitchService.sendMessage(channel, `${command} doesn't have a description.`);
    }

    private async getAliasCommandName(command: string): Promise<string | undefined> {
        
        const aliases = await this.commandAliasRepository.getList();
        const alias = aliases.find((alias) => alias.alias === command);
        if (alias) {
            return alias.commandName;
        }
        return undefined;
    }

    public getDescription(): string {
        return `Outputs information about a command including its arguments (if any). Optional arguments in brackets. Usage: !explain <command>`;
    }
}