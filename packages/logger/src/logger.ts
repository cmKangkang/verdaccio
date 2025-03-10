import buildDebug from 'debug';
import _ from 'lodash';
import pino from 'pino';

import { warningUtils } from '@verdaccio/core';
import prettifier, { fillInMsgTemplate } from '@verdaccio/logger-prettify';

const debug = buildDebug('verdaccio:logger');

export let logger;

function isProd() {
  return process.env.NODE_ENV === 'production';
}

const DEFAULT_LOG_FORMAT = isProd() ? 'json' : 'pretty';

export type LogPlugin = {
  dest: string;
  options?: any[];
};

export type LogType = 'file' | 'stdout';
export type LogFormat = 'json' | 'pretty-timestamped' | 'pretty';

export function createLogger(
  options = { level: 'http' },
  destination = pino.destination(1),
  format: LogFormat = DEFAULT_LOG_FORMAT,
  prettyPrintOptions = {
    // we hide warning since the prettifier should not be used in production
    // https://getpino.io/#/docs/pretty?id=prettifier-api
    suppressFlushSyncWarning: true,
  }
) {
  if (_.isNil(format)) {
    format = DEFAULT_LOG_FORMAT;
  }

  let pinoConfig = {
    customLevels: {
      http: 25,
    },
    ...options,
    level: options.level,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  debug('has prettifier? %o', !isProd());
  // pretty logs are not allowed in production for performance reasons
  if ((format === DEFAULT_LOG_FORMAT || format !== 'json') && isProd() === false) {
    pinoConfig = Object.assign({}, pinoConfig, {
      prettifier,
      // more info
      // https://github.com/pinojs/pino-pretty/issues/37
      prettyPrint: {
        levelFirst: true,
        prettyStamp: format === 'pretty-timestamped',
        ...prettyPrintOptions,
      },
    });
  } else {
    pinoConfig = Object.assign({}, pinoConfig, {
      // more info
      // https://github.com/pinojs/pino/blob/v7.1.0/docs/api.md#hooks-object
      hooks: {
        logMethod(inputArgs, method) {
          const [templateObject, message, ...otherArgs] = inputArgs;
          const templateVars =
            !!templateObject && typeof templateObject === 'object'
              ? Object.getOwnPropertyNames(templateObject)
              : [];
          if (!message || !templateVars.length) return method.apply(this, inputArgs);
          const hydratedMessage = fillInMsgTemplate(message, templateObject, false);
          return method.apply(this, [templateObject, hydratedMessage, ...otherArgs]);
        },
      },
    });
  }
  const logger = pino(pinoConfig, destination);

  if (process.env.DEBUG) {
    logger.on('level-change', (lvl, val, prevLvl, prevVal) => {
      debug('%s (%d) was changed to %s (%d)', lvl, val, prevLvl, prevVal);
    });
  }

  return logger;
}

export function getLogger() {
  if (_.isNil(logger)) {
    // FIXME: not sure about display here a warning
    warningUtils.emit(warningUtils.Codes.VERWAR002);
    return;
  }

  return logger;
}

const DEFAULT_LOGGER_CONF: LoggerConfigItem = {
  type: 'stdout',
  format: 'pretty',
  level: 'http',
};

export type LoggerConfigItem = {
  type?: LogType;
  plugin?: LogPlugin;
  format?: LogFormat;
  path?: string;
  level?: string;
};

export type LoggerConfig = LoggerConfigItem[];

export function setup(options: LoggerConfig | LoggerConfigItem = DEFAULT_LOGGER_CONF) {
  debug('setup logger');
  const isLegacyConf = Array.isArray(options);
  if (isLegacyConf) {
    warningUtils.emit(warningUtils.Codes.VERDEP002);
  }

  // verdaccio 5 does not allow multiple logger configuration
  // backward compatible, pick only the first option
  // next major will thrown an error
  let loggerConfig = isLegacyConf ? options[0] : options;
  if (!loggerConfig?.level) {
    loggerConfig = Object.assign(
      {},
      {
        level: 'http',
      },
      loggerConfig
    );
  }
  const pinoConfig = { level: loggerConfig.level };
  if (loggerConfig.type === 'file') {
    debug('logging file enabled');
    logger = createLogger(pinoConfig, pino.destination(loggerConfig.path), loggerConfig.format);
  } else if (loggerConfig.type === 'rotating-file') {
    warningUtils.emit(warningUtils.Codes.VERWAR003);
    debug('logging stdout enabled');
    logger = createLogger(pinoConfig, pino.destination(1), loggerConfig.format);
  } else {
    debug('logging stdout enabled');
    logger = createLogger(pinoConfig, pino.destination(1), loggerConfig.format);
  }

  if (isProd()) {
    // why only on prod? https://github.com/pinojs/pino/issues/920#issuecomment-710807667
    const finalHandler = pino.final(logger, (err, finalLogger, event) => {
      finalLogger.info(`${event} caught`);
      if (err) {
        finalLogger.error(err, 'error caused exit');
      }
      process.exit(err ? 1 : 0);
    });

    process.on('uncaughtException', (err) => finalHandler(err, 'uncaughtException'));
    process.on('unhandledRejection', (err) => finalHandler(err as Error, 'unhandledRejection'));
    process.on('beforeExit', () => finalHandler(null, 'beforeExit'));
    process.on('exit', () => finalHandler(null, 'exit'));
    process.on('uncaughtException', (err) => finalHandler(err, 'uncaughtException'));
    process.on('SIGINT', () => finalHandler(null, 'SIGINT'));
    process.on('SIGQUIT', () => finalHandler(null, 'SIGQUIT'));
    process.on('SIGTERM', () => finalHandler(null, 'SIGTERM'));
  }

  return logger;
}
