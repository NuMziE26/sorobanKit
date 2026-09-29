# @stellar-tags/payment-router

TypeScript bindings for the `payment-router` Soroban contract.

## Installation

```bash
npm install @stellar-tags/payment-router
```

## Usage

```ts
import {
  Client,
  ContractError,
  isContractError,
  type ErrorVariant,
} from "@stellar-tags/payment-router";

const client = new Client({ contractId, networkPassphrase, rpcUrl });

try {
  await client.pay({ /* ... */ });
} catch (err) {
  if (isContractError(err)) {
    // `err` is narrowed to `ContractError`
    switch (err.variant) {
      case "Unauthorized":
        // handle unauthorized
        break;
      case "InsufficientBalance":
        // handle insufficient balance
        break;
      default:
        // exhaustively handled by the union
        break;
    }
  }
}
```

## Contract errors

The contract's `Error` enum variants are exported as a discriminated union so
frontend code can type-check errors without `as any` casts:

- `ContractError` — union of all known error variants
- `ErrorVariant` — string literal union of variant names
- `isContractError(value)` — type guard narrowing `unknown` to `ContractError`

Each variant carries a `variant` discriminant and a human-readable `message`.

## Regenerating bindings

```bash
npm run generate:bindings
```

The generator emits the contract function signatures and the error enum
variants into `src/index.ts`. Re-run it whenever the contract ABI changes.

## Type checking

```bash
npx tsc --noEmit
```

`tsconfig.json` enables `strict` mode; the exported error types are checked as
part of the package build.
