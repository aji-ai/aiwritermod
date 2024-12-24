const logger = require("pino")({
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: true,
            singleLine: false,
            ignore: 'pid,hostname',
            messageFormat: '{msg} - {req.method} {req.url}',
            errorLikeObjectKeys: ['err', 'error'],
            errorProps: 'stack, type, message',
        }
    }
});
module.exports = { logger }
