import pino from 'pino';
import pkg from '../package.json';

// Simple pino configuration for the frontend
const logger = pino({
  level: import.meta.env.PROD ? 'info' : 'debug',
  browser: {
    asObject: true
  },
  base: {
    service: 'stellar-payment-platform',
    version: pkg.version
  }
});

export default logger;
