#!/usr/bin/env node
'use strict';

/**
 * scripts/deploy.js
 *
 * Automated CLI tool to compile, optimize, deploy, initialize, and upgrade
 * the Soroban PaymentRouter smart contract, and update backend/frontend configs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Network Configurations ───────────────────────────────────────────────────

const NETWORKS = {
  testnet: {
    name: 'testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  mainnet: {
    name: 'mainnet',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
  },
  futurenet: {
    name: 'futurenet',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
  },
  local: {
    name: 'local',
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    networkPassphrase: 'Standalone Network ; February 2017',
    horizonUrl: 'http://localhost:8000',
  },
};

// ── Default Paths ────────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTRACT_DIR = path.join(ROOT_DIR, 'payment_router');
const DEFAULT_WASM_PATH = path.join(
  CONTRACT_DIR,
  'target',
  'wasm32-unknown-unknown',
  'release',
  'payment_router.wasm'
);
const DEFAULT_OPTIMIZED_WASM_PATH = path.join(
  CONTRACT_DIR,
  'target',
  'wasm32-unknown-unknown',
  'release',
  'payment_router.optimized.wasm'
);

// ── CLI Argument Parser ──────────────────────────────────────────────────────

/**
 * Parses CLI arguments into structured options.
 *
 * @param {string[]} argv
 * @returns {object}
 */
const parseArgs = (argv = process.argv.slice(2)) => {
  const options = {
    command: 'deploy',
    network: 'testnet',
    source: process.env.STELLAR_SECRET_KEY || process.env.SOROBAN_SECRET_KEY || null,
    admin: process.env.ADMIN_ADDRESS || null,
    treasury: process.env.PLATFORM_TREASURY || null,
    feeBps: 100, // 1%
    feeCap: '10000000', // 1 XLM (7 decimals)
    maxAmount: '1000000000000000',
    contractId: process.env.CONTRACT_ID || process.env.PAYMENT_ROUTER_CONTRACT_ID || null,
    wasmPath: null,
    dryRun: false,
    skipBuild: false,
    envFiles: [
      path.join(ROOT_DIR, 'stellar-payment-platform', '.env'),
      path.join(ROOT_DIR, 'payment-dashboard', '.env'),
      path.join(ROOT_DIR, '.env'),
    ],
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.command = 'help';
      return options;
    } else if (arg === '--version' || arg === '-v') {
      options.command = 'version';
      return options;
    } else if (arg === '--network' || arg === '-n') {
      options.network = argv[++i];
    } else if (arg === '--source' || arg === '-s') {
      options.source = argv[++i];
    } else if (arg === '--admin') {
      options.admin = argv[++i];
    } else if (arg === '--treasury') {
      options.treasury = argv[++i];
    } else if (arg === '--fee-bps') {
      options.feeBps = parseInt(argv[++i], 10);
    } else if (arg === '--fee-cap') {
      options.feeCap = argv[++i];
    } else if (arg === '--max-amount') {
      options.maxAmount = argv[++i];
    } else if (arg === '--contract-id' || arg === '-c') {
      options.contractId = argv[++i];
    } else if (arg === '--wasm') {
      options.wasmPath = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--env-file') {
      options.envFiles.push(path.resolve(argv[++i]));
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const cmd = positional[0].toLowerCase();
    if (['build', 'deploy', 'upgrade', 'init', 'status'].includes(cmd)) {
      options.command = cmd;
    }
    if (positional[1] && !options.contractId) {
      options.contractId = positional[1];
    }
  }

  return options;
};

// ── Dry Run Helpers ──────────────────────────────────────────────────────────

/**
 * Logs a step that would be executed on-chain, without performing it.
 *
 * @param {string} description
 */
const logDryRun = (description) => {
  console.log(`[DRY RUN] Would execute: ${description}`);
};

/**
 * Runs a shell command, or logs it when in dry-run mode.
 *
 * @param {string} command
 * @param {object} [execOptions]
 * @param {boolean} [dryRun]
 * @returns {string|null} Command output, or null when skipped.
 */
const runOrDryRun = (command, execOptions = {}, dryRun = false) => {
  if (dryRun) {
    logDryRun(command);
    return null;
  }
  return execSync(command, execOptions);
};

// ── Environment File Updater ─────────────────────────────────────────────────

/**
 * Updates or sets an environment variable in an .env file.
 *
 * @param {string} filePath - Absolute path to .env file.
 * @param {string} key - Environment variable key.
 * @param {string} value - Environment variable value.
 * @returns {boolean} True if updated/created.
 */
const setEnvVariable = (filePath, key, value) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }

    const regex = new RegExp(`^(${key}=).*$`, 'm');
    let updatedContent;
    if (regex.test(content)) {
      updatedContent = content.replace(regex, `${key}="${value}"`);
    } else {
      const newLine = content.endsWith('\n') || content.length === 0 ? '' : '\n';
      updatedContent = `${content}${newLine}${key}="${value}"\n`;
    }

    fs.writeFileSync(filePath, updatedContent, 'utf8');
    return true;
  } catch (err) {
    console.error(`[deploy] Failed to update env file ${filePath}:`, err.message);
    return false;
  }
};

/**
 * Updates all relevant frontend and backend configuration files with the contract ID.
 *
 * @param {string} contractId
 * @param {string[]} envFiles
 * @param {object} [options]
 * @returns {string[]} List of successfully updated files.
 */
const updateAllConfigs = (contractId, envFiles = [], options = {}) => {
  const updated = [];

  if (options.dryRun) {
    logDryRun(`update config files with contract ID ${contractId}`);
    for (const envFile of envFiles) {
      logDryRun(`set PAYMENT_ROUTER_CONTRACT_ID/CONTRACT_ID/VITE_CONTRACT_ID in ${envFile}`);
    }
    return updated;
  }

  for (const envFile of envFiles) {
    if (setEnvVariable(envFile, 'PAYMENT_ROUTER_CONTRACT_ID', contractId)) {
      setEnvVariable(envFile, 'CONTRACT_ID', contractId);
      setEnvVariable(envFile, 'VITE_CONTRACT_ID', contractId);
      updated.push(envFile);
    }
  }

  // Also update payment-dashboard/src/views/shared.js if present and allowed
  if (options.updateSharedJs !== false) {
    const rootDir = options.rootDir || ROOT_DIR;
    const sharedJsPath = path.join(rootDir, 'payment-dashboard', 'src', 'views', 'shared.js');
    if (fs.existsSync(sharedJsPath)) {
      try {
        let content = fs.readFileSync(sharedJsPath, 'utf8');
        const contractIdRegex = /export const CONTRACT_ID = ['"][^'"]*['"];/;
        if (contractIdRegex.test(content)) {
          content = content.replace(
            contractIdRegex,
            `export const CONTRACT_ID = '${contractId}';`
          );
          fs.writeFileSync(sharedJsPath, content, 'utf8');
          updated.push(sharedJsPath);
        }
      } catch (err) {
        console.warn('[deploy] Could not update shared.js:', err.message);
      }
    }
  }

  return updated;
};

// ── Compilation & Optimization ───────────────────────────────────────────────

/**
 * Compiles the Soroban contract to WASM and optimizes bytecode.
 *
 * @param {object} options
 * @returns {string} Path to the compiled/optimized WASM file.
 */
const compileAndOptimizeWasm = (options = {}) => {
  if (options.wasmPath && fs.existsSync(options.wasmPath)) {
    console.log(`📦 Using provided WASM file: ${options.wasmPath}`);
    return options.wasmPath;
  }

  console.log('🔨 Compiling Soroban smart contract...');

  try {
    execSync('cargo build --target wasm32-unknown-unknown --release', {
      cwd: CONTRACT_DIR,
      stdio: 'inherit',
    });
  } catch {
    console.warn('⚠️  Cargo compilation failed or cargo not available.');
  }

  let wasmPath = DEFAULT_WASM_PATH;
  if (!fs.existsSync(wasmPath)) {
    console.warn(`⚠️  Compiled WASM not found at ${wasmPath}`);
    return wasmPath;
  }

  console.log('⚙️  Optimizing WASM bytecode...');
  try {
    execSync(
      `stellar contract optimize --wasm ${wasmPath} --wasm-out ${DEFAULT_OPTIMIZED_WASM_PATH}`,
      { cwd: CONTRACT_DIR, stdio: 'inherit' }
    );
    wasmPath = DEFAULT_OPTIMIZED_WASM_PATH;
  } catch {
    console.warn('⚠️  Optimization failed; using unoptimized WASM.');
  }

  return wasmPath;
};

// ── RPC / On-chain Operations ────────────────────────────────────────────────

/**
 * Deploys the contract to the configured network.
 *
 * @param {object} options
 * @param {string} wasmPath
 * @returns {string|null} Deployed contract ID, or null in dry-run.
 */
const deployContract = (options, wasmPath) => {
  const network = NETWORKS[options.network] || NETWORKS.testnet;

  if (options.dryRun) {
    logDryRun(
      `stellar contract deploy --wasm ${wasmPath} --network ${network.name} --rpc-url ${network.rpcUrl}`
    );
    return null;
  }

  const output = execSync(
    `stellar contract deploy --wasm ${wasmPath} --network ${network.name} --rpc-url ${network.rpcUrl}`,
    { cwd: CONTRACT_DIR, encoding: 'utf8' }
  );
  return output.trim();
};

/**
 * Initializes the deployed contract with admin/treasury/fee configuration.
 *
 * @param {object} options
 * @param {string} contractId
 */
const initializeContract = (options, contractId) => {
  const network = NETWORKS[options.network] || NETWORKS.testnet;

  if (options.dryRun) {
    logDryRun(
      `stellar contract invoke --id ${contractId} --network ${network.name} -- initialize --admin ${options.admin} --treasury ${options.treasury} --fee_bps ${options.feeBps} --fee_cap ${options.feeCap} --max_amount ${options.maxAmount}`
    );
    return;
  }

  execSync(
    `stellar contract invoke --id ${contractId} --network ${network.name} -- initialize --admin ${options.admin} --treasury ${options.treasury} --fee_bps ${options.feeBps} --fee_cap ${options.feeCap} --max_amount ${options.maxAmount}`,
    { cwd: CONTRACT_DIR, stdio: 'inherit' }
  );
};

/**
 * Upgrades an existing contract to a new WASM hash.
 *
 * @param {object} options
 * @param {string} contractId
 * @param {string} wasmPath
 */
const upgradeContract = (options, contractId, wasmPath) => {
  const network = NETWORKS[options.network] || NETWORKS.testnet;

  if (options.dryRun) {
    logDryRun(
      `stellar contract install --wasm ${wasmPath} --network ${network.name} --rpc-url ${network.rpcUrl}`
    );
    logDryRun(
      `stellar contract invoke --id ${contractId} --network ${network.name} -- upgrade --new_wasm_hash <hash>`
    );
    return;
  }

  const installOutput = execSync(
    `stellar contract install --wasm ${wasmPath} --network ${network.name} --rpc-url ${network.rpcUrl}`,
    { cwd: CONTRACT_DIR, encoding: 'utf8' }
  );
  const wasmHash = installOutput.trim();

  execSync(
    `stellar contract invoke --id ${contractId} --network ${network.name} -- upgrade --new_wasm_hash ${wasmHash}`,
    { cwd: CONTRACT_DIR, stdio: 'inherit' }
  );
};

/**
 * Fetches the current status of a deployed contract.
 *
 * @param {object} options
 * @param {string} contractId
 */
const getContractStatus = (options, contractId) => {
  const network = NETWORKS[options.network] || NETWORKS.testnet;

  if (options.dryRun) {
    logDryRun(
      `stellar contract invoke --id ${contractId} --network ${network.name} -- get_config`
    );
    return;
  }

  execSync(
    `stellar contract invoke --id ${contractId} --network ${network.name} -- get_config`,
    { cwd: CONTRACT_DIR, stdio: 'inherit' }
  );
};

// ── Input Validation ─────────────────────────────────────────────────────────

/**
 * Validates parsed options before any on-chain work.
 *
 * @param {object} options
 * @returns {boolean} True when valid.
 */
const validateOptions = (options) => {
  if (!NETWORKS[options.network]) {
    console.error(`❌ Unknown network: ${options.network}`);
    console.error(`   Supported networks: ${Object.keys(NETWORKS).join(', ')}`);
    return false;
  }

  if (options.command === 'deploy' || options.command === 'init') {
    if (!options.admin) {
      console.error('❌ Missing --admin address.');
      return false;
    }
    if (!options.treasury) {
      console.error('❌ Missing --treasury address.');
      return false;
    }
  }

  if (options.command === 'upgrade' || options.command === 'status') {
    if (!options.contractId) {
      console.error('❌ Missing --contract-id.');
      return false;
    }
  }

  return true;
};

// ── Help ─────────────────────────────────────────────────────────────────────

const printHelp = () => {
  console.log(`
PaymentRouter Deployment CLI

Usage:
  node scripts/deploy.js [command] [options]

Commands:
  build                 Compile and optimize the contract WASM
  deploy                Compile, deploy, and initialize the contract
  upgrade               Upgrade an existing contract
  init                  Initialize an existing contract
  status                Show current contract configuration

Options:
  -n, --network <name>  Network: testnet | mainnet | futurenet | local (default: testnet)
  -s, --source <key>    Stellar secret key for signing
      --admin <addr>    Admin address
      --treasury <addr> Platform treasury address
      --fee-bps <n>     Fee in basis points (default: 100)
      --fee-cap <n>     Fee cap (default: 10000000)
      --max-amount <n>  Max transfer amount
  -c, --contract-id <id> Contract ID (for upgrade/init/status)
      --wasm <path>     Use a pre-built WASM file
      --dry-run         Simulate the workflow without RPC calls or on-chain transactions
      --skip-build      Skip WASM compilation
      --env-file <path> Additional .env file to update
  -h, --help            Show this help
  -v, --version         Show version
`);
};

// ── Main ─────────────────────────────────────────────────────────────────────

const main = () => {
  const options = parseArgs();

  if (options.command === 'help') {
    printHelp();
    return;
  }

  if (options.command === 'version') {
    const pkg = require(path.join(ROOT_DIR, 'package.json'));
    console.log(pkg.version || '0.0.0');
    return;
  }

  if (!validateOptions(options)) {
    process.exitCode = 1;
    return;
  }

  const network = NETWORKS[options.network];
  console.log(`\n🌐 Network: ${network.name} (${network.rpcUrl})`);
  if (options.dryRun) {
    console.log('🧪 DRY RUN enabled — no RPC calls or on-chain transactions will be made.');
  }

  let wasmPath = options.wasmPath;

  if (options.command === 'build' || options.command === 'deploy' || options.command === 'upgrade') {
    if (!options.skipBuild) {
      wasmPath = compileAndOptimizeWasm(options);
    } else if (!wasmPath) {
      wasmPath = DEFAULT_OPTIMIZED_WASM_PATH;
    }
  }

  if (options.command === 'build') {
    console.log(`✅ Build complete: ${wasmPath}`);
    return;
  }

  if (options.command === 'deploy') {
    const contractId = deployContract(options, wasmPath);
    if (options.dryRun) {
      logDryRun('initialize contract after deploy');
      updateAllConfigs('<contract-id>', options.envFiles, { dryRun: true });
      console.log('\n✅ Dry run complete. No transactions were submitted.');
      return;
    }
    if (!contractId) {
      console.error('❌ Deployment did not return a contract ID.');
      process.exitCode = 1;
      return;
    }
    console.log(`✅ Deployed contract: ${contractId}`);
    initializeContract(options, contractId);
    const updated = updateAllConfigs(contractId, options.envFiles);
    console.log(`✅ Updated ${updated.length} config file(s).`);
    return;
  }

  if (options.command === 'init') {
    initializeContract(options, options.contractId);
    if (options.dryRun) {
      console.log('\n✅ Dry run complete. No transactions were submitted.');
      return;
    }
    console.log('✅ Contract initialized.');
    return;
  }

  if (options.command === 'upgrade') {
    upgradeContract(options, options.contractId, wasmPath);
    if (options.dryRun) {
      console.log('\n✅ Dry run complete. No transactions were submitted.');
      return;
    }
    console.log('✅ Contract upgraded.');
    return;
  }

  if (options.command === 'status') {
    getContractStatus(options, options.contractId);
    return;
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  NETWORKS,
  parseArgs,
  setEnvVariable,
  updateAllConfigs,
  compileAndOptimizeWasm,
  deployContract,
  initializeContract,
  upgradeContract,
  getContractStatus,
  validateOptions,
  logDryRun,
  runOrDryRun,
  main,
};
