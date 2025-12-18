"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowIso = nowIso;
exports.hrNowMs = hrNowMs;
exports.ensureDir = ensureDir;
exports.createJsonlWriter = createJsonlWriter;
exports.stableStringify = stableStringify;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
function nowIso() {
    return new Date().toISOString();
}
function hrNowMs() {
    return Number(process.hrtime.bigint() / 1000000n);
}
async function ensureDir(dir) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
}
async function createJsonlWriter(outDir, filename) {
    await ensureDir(outDir);
    const path = (0, node_path_1.join)(outDir, filename);
    const stream = (0, node_fs_1.createWriteStream)(path, { flags: 'a' });
    return {
        path,
        write: async (obj) => {
            const line = JSON.stringify(obj);
            if (!stream.write(line + '\n')) {
                await new Promise((resolve) => stream.once('drain', resolve));
            }
        },
        close: async () => {
            await new Promise((resolve, reject) => {
                stream.end(() => resolve());
                stream.on('error', reject);
            });
        },
    };
}
function stableStringify(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort(), 2);
}
