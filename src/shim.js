import { Buffer } from 'buffer';
export { Buffer };
globalThis.Buffer = globalThis.Buffer || Buffer;
globalThis.process = globalThis.process || { env: {}, browser: true, version: '', versions: {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)) };
