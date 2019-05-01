#! /usr/bin/env node

// XXX: Hack to enable logging for the cli but not tests.
process.env.APPSYNC_EMULATOR_LOG = 1;

const fs = require('fs');
const path = require('path');
const util = require('util');
const pkgUp = require('pkg-up');
const { ArgumentParser } = require('argparse');
const dynamoEmulator = require('@conduitvc/dynamodb-emulator');
const createServer = require('../server');
const defaultConfig = require('../config');
const { DynamoDB } = require('aws-sdk');

async function deriveDynamoClient({ DynamoDB: config }, pkgPath) {
  if (!config.emulator) {
    /* eslint-disable no-console */
    console.log('dynamodb config: ', util.inspect(config, false, 2, true));
    return new DynamoDB(...config);
  }

  // start the dynamodb emulator
  const dbPath = path.join(path.dirname(pkgPath), '.dynamodb');
  const port = { config };
  const emulator = await dynamoEmulator.launch({
    dbPath,
    port,
  });
  console.log(`dynamodb emulator port: ${port}, dbPath: ${dbPath}`);
  process.on('SIGINT', () => {
    // _ensure_ we do not leave java processes lying around.
    emulator.terminate().then(() => {
      process.exit(0);
    });
  });
  return dynamoEmulator.getClient(emulator);
}

const main = async () => {
  const parser = new ArgumentParser({
    version: require('../package.json').version,
    addHelp: true,
    description: 'AWS AppSync Emulator',
  });

  parser.addArgument(['--path'], {
    help:
      'Directory path in which serverless.yml, general config file is configured',
    type: serverlessPath => {
      // eslint-disable-next-line
      serverlessPath = path.resolve(serverlessPath);
      if (!fs.existsSync(serverlessPath)) {
        throw new Error(`${serverlessPath} does not exist`);
      }
      return serverlessPath;
    },
  });

  parser.addArgument(['-p', '--port'], {
    help: 'Port to bind the emulator to',
    type: 'int',
  });

  parser.addArgument(['-wsp', '--ws-port'], {
    help: 'Port to bind emulator subscriptions',
    type: 'int',
  });

  parser.addArgument(['--config'], {
    help:
      'Name of optional configuration file which resides in the same directory as serverless.yml (default is config)',
    type: 'string',
  });
  // argparse converts any argument with a dash to underscores
  // eslint-disable-next-line
  let {
    ws_port: wsPort,
    port,
    path: serverlessPath,
    config: configFileName,
  } = parser.parseArgs();
  port = port || 0;
  serverlessPath = serverlessPath || process.cwd();
  configFileName = configFileName || 'appSyncConfig';

  const pkgPath = pkgUp.sync(serverlessPath);
  const customConfigFilePath = path.join(serverlessPath, configFileName);
  const hasCustomConfig = await new Promise(resolve => {
    try {
      fs.accessSync(customConfigFilePath);
      resolve(true);
    } catch (e) {
      resolve(false);
    }
  });

  const config = Object.assign(
    {},
    defaultConfig,
    // eslint-disable-next-line import/no-dynamic-require
    hasCustomConfig ? require(customConfigFilePath) : {},
  );
  const dynamodb = await deriveDynamoClient(config, pkgPath);

  const serverless = path.join(path.dirname(pkgPath), 'serverless.yml');
  const server = await createServer({ wsPort, serverless, port, dynamodb });
  // eslint-disable-next-line no-console
  console.log('started at url:', server.url);
};

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
