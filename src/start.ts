import BotServer from './botServer';
import { IConfig } from './config';

if (process.argv[2] !== 'test') {
    const server = new BotServer();
    server.start(process.env.NODE_ENV === 'development' ? 3000 : 3000);
} else {
    // unit testing
}
