import { inject, injectable, LazyServiceIdentifer } from "inversify";
import { EventTypes, IEventSubNotification, IRewardRedemeptionEvent, ChannelPointRedemption, IChannelPointReward, AchievementType, IUser } from "../models";
import UserTaxHistoryRepository from "../database/userTaxHistoryRepository";
import UserTaxStreakRepository from "../database/userTaxStreakRepository";
import StreamActivityRepository from "../database/streamActivityRepository";
import TwitchChannelPointRewardService from "./channelPointRewardService";
import UserService from "./userService";
import BotSettingsService, { BotSettings } from "./botSettingsService";
import TwitchEventService from "./twitchEventService";
import EventAggregator from "./eventAggregator";
import { IDBUserTaxHistory, TaxType } from "../models/taxHistory";
import { Logger, LogType } from "../logger";

@injectable()
export default class TaxService {
    private isEnabled = async (): Promise<boolean> => JSON.parse(await this.botSettingsService.getValue(BotSettings.TaxEventIsEnabled));

    constructor(
        @inject(UserService) private userService: UserService,
        @inject(UserTaxHistoryRepository) private userTaxHistoryRepository: UserTaxHistoryRepository,
        @inject(UserTaxStreakRepository) private userTaxStreakRepository: UserTaxStreakRepository,
        @inject(StreamActivityRepository) private streamActivityRepository: StreamActivityRepository,
        @inject(TwitchChannelPointRewardService) private channelPointRewardService: TwitchChannelPointRewardService,
        @inject(BotSettingsService) private botSettingsService: BotSettingsService,
        @inject(EventAggregator) private eventAggregator: EventAggregator,
        @inject(new LazyServiceIdentifer(() => TwitchEventService)) private twitchEventService: TwitchEventService
    ) {
        this.twitchEventService.subscribeToEvent(EventTypes.StreamOnline, this.streamOnline);
        this.twitchEventService.subscribeToEvent(EventTypes.ChannelPointsRedeemed, this.channelPointsRedeemed);
    }

    /**
     * Callback that is triggered when a channel point redemption event happens.
     * @param notification The channel point redemption notification.
     */
    private async channelPointsRedeemed(notification: IEventSubNotification): Promise<void> {
        if (!(await this.isEnabled())) {
            return;
        }

        Logger.info(LogType.TwitchEvents, `TaxService Channel Point Redemption`, notification);
        const taxChannelReward = await this.channelPointRewardService.getChannelRewardForRedemption(ChannelPointRedemption.Tax);

        Logger.info(
            LogType.TwitchEvents,
            `TaxChannelReward Title: ${taxChannelReward?.title} -- Notified Reward Title: ${(notification.event as IRewardRedemeptionEvent).reward.title}`
        );
        if (taxChannelReward && (notification.event as IRewardRedemeptionEvent).reward.title === taxChannelReward.title) {
            const user = await this.userService.getUser((notification.event as IRewardRedemeptionEvent).user_login);
            Logger.info(LogType.TwitchEvents, "User for reward redemption", user);
            if (user) {
                this.logDailyTax(user, (notification.event as IRewardRedemeptionEvent).reward.id);
            }
        }
    }

    public async logDailyTax(user: IUser, rewardId: string) {
        // Adds a tax redemption for the user.
        if (user.id) {
            await this.userTaxHistoryRepository.add(user.id, rewardId, TaxType.ChannelPoints);

            const count = await this.userTaxHistoryRepository.getCountForUser(user.id, TaxType.ChannelPoints);
            this.eventAggregator.publishAchievement({ user, type: AchievementType.DailyTaxesPaid, count });
        }
    }

    public async logDailyBitTax(user: IUser) {
        // Adds a tax redemption for the user.
        if (user.id) {
            await this.userTaxHistoryRepository.add(user.id, undefined, TaxType.Bits);

            const count = await this.userTaxHistoryRepository.getCountForUser(user.id, TaxType.Bits);
            this.eventAggregator.publishAchievement({ user, type: AchievementType.DailyBitTaxesPaid, count });
        }
    }

    /**
     * Function that triggers when the StreamOnline Twitch Event is triggered.
     * Will go through all users who have paid tax since the last stream to increase their current streaks.
     * Will also go through all users who have not paid tax since the last stream to reset their current streaks.
     */
    private async streamOnline(): Promise<void> {
        if (!(await this.isEnabled())) {
            return;
        }

        const dateTimeOnline = new Date(Date.now());
        const lastOnlineEvent = await this.streamActivityRepository.getLatestForEvent(EventTypes.StreamOnline);
        let lastOnlineDate: Date | undefined;
        let usersNotPaidTax: IDBUserTaxHistory[] = [];
        let usersPaidTax: IDBUserTaxHistory[] = [];

        if (lastOnlineEvent) {
            lastOnlineDate = lastOnlineEvent.dateTimeTriggered;
        }

        //TODO: Should probably have a way to do these updates in bulk rather than iterating through each user.

        if (lastOnlineDate) {
            // Get all users who have paid tax since the last time the stream was online and update their streak.
            usersPaidTax = await this.userTaxHistoryRepository.getSinceDate(lastOnlineDate);
            usersPaidTax.forEach(async (taxEvent) => {
                const currentStreakData = await this.userTaxStreakRepository.get(taxEvent.userId);
                if (currentStreakData) {
                    let longestStreak: number = currentStreakData.longestStreak;
                    if (currentStreakData.currentStreak + 1 > currentStreakData.longestStreak) {
                        longestStreak = currentStreakData.currentStreak + 1;
                    }
                    if (taxEvent.id) {
                        await this.userTaxStreakRepository.updateStreak(taxEvent.userId, taxEvent.id, currentStreakData.currentStreak + 1, longestStreak);
                    }
                }
            });
        } else {
            // Stream hasn't been online yet, so streaks still need to be setup.
            const usersPaidTax = await this.userTaxHistoryRepository.getAll(TaxType.ChannelPoints);
            usersPaidTax.forEach(async (taxEvent) => {
                if (taxEvent.id) {
                    await this.userTaxStreakRepository.add(taxEvent.userId, taxEvent.id);
                }
            });
        }

        // Get all users who haven't paid tax since the last online date.
        const lastOnlineEvents = await this.streamActivityRepository.getLastEvents(EventTypes.StreamOnline, 2, "asc");
        if (lastOnlineEvents.length === 2) {
            usersNotPaidTax = await this.userTaxHistoryRepository.getUsersBetweenDates(
                lastOnlineEvents[0].dateTimeTriggered,
                lastOnlineEvents[1].dateTimeTriggered
            );
            usersNotPaidTax.filter((taxEvent) => {
                return !usersPaidTax.includes(taxEvent);
            });
        }

        // Update all users who have not paid tax since the last stream to set current streak to 0.
        usersNotPaidTax.forEach(async (taxEvent) => {
            const streakEvent = await this.userTaxStreakRepository.get(taxEvent.userId);
            if (streakEvent && taxEvent.id) {
                await this.userTaxStreakRepository.updateStreak(taxEvent.userId, taxEvent.id, 0, streakEvent.longestStreak);
            }
        });

        await this.streamActivityRepository.add(EventTypes.StreamOnline, dateTimeOnline);
    }
}
