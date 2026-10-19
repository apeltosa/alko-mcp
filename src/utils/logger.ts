import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Only log to file in local STDIO development (not in production / HTTP mode)
// In container environments (like Render or Cloud Run), /tmp is on tmpfs (RAM),
// and persistent file logging without rotation causes memory leaks.
const isProductionOrHttp =
  process.env.NODE_ENV === 'production' ||
  process.env.MCP_TRANSPORT === 'http' ||
  !!process.env.PORT ||
  process.env.DISABLE_FILE_LOGGING === 'true';

const streams: pino.StreamEntry[] = [{ stream: pino.destination(2) }]; // Always write to stderr

let logFilePath: string | null = null;
if (!isProductionOrHttp) {
  logFilePath = path.join(os.tmpdir(), 'alko-mcp.log');
  const logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  streams.push({ stream: logFileStream });
}

/**
 * Application logger using pino
 * IMPORTANT: Writes to stderr (and optional temp log file only in local stdio dev)
 * MCP uses stdout for JSON-RPC communication, so all logs must go to stderr
 */
const pinoLogger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.multistream(streams)
);

// Log the log file location if enabled
if (logFilePath) {
  pinoLogger.info(`Log file: ${logFilePath}`);
}

/**
 * Simplified logger wrapper with consistent API
 */
export const logger = {
  info: (msg: string, obj?: Record<string, unknown>) => {
    if (obj) {
      pinoLogger.info(obj, msg);
    } else {
      pinoLogger.info(msg);
    }
  },
  error: (msg: string, obj?: Record<string, unknown>) => {
    if (obj) {
      pinoLogger.error(obj, msg);
    } else {
      pinoLogger.error(msg);
    }
  },
  warn: (msg: string, obj?: Record<string, unknown>) => {
    if (obj) {
      pinoLogger.warn(obj, msg);
    } else {
      pinoLogger.warn(msg);
    }
  },
  debug: (msg: string, obj?: Record<string, unknown>) => {
    if (obj) {
      pinoLogger.debug(obj, msg);
    } else {
      pinoLogger.debug(msg);
    }
  },
};

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return pinoLogger.child(context);
}
