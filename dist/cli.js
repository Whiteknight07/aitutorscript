"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const promises_1 = require("node:fs/promises");
const args_1 = require("./args");
const run_1 = require("./run");
async function main() {
    const argv = process.argv;
    if (argv.includes('--help')) {
        (0, args_1.printHelp)();
        process.exit(0);
    }
    const args = (0, args_1.parseArgs)(argv);
    const envSummary = await readEnvSummary();
    await (0, run_1.runExperiments)({ args, envSummary });
}
async function readEnvSummary() {
    const keys = [
        'AI_GATEWAY_API_KEY',
        'OPENAI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'NODE_ENV',
    ];
    const present = {};
    for (const key of keys)
        present[key] = Boolean(process.env[key]);
    const envFile = await safeReadFile('.env');
    return {
        present,
        hasDotEnvFile: envFile != null,
    };
}
async function safeReadFile(path) {
    try {
        return await (0, promises_1.readFile)(path, 'utf8');
    }
    catch {
        return null;
    }
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
