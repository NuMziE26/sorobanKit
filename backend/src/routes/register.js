const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const { PrismaClient } = require('@prisma/client');
const { ApiError } = require('../errors');

const router = express.Router();
const prisma = new PrismaClient();

router.post('/register', async (req, res, next) => {
  try {
    const { address, memo } = req.body || {};

    if (!address || typeof address !== 'string') {
      throw new ApiError('INVALID_INPUT', 'address is required');
    }

    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new ApiError('INVALID_INPUT', 'Invalid Stellar address');
    }

    const existing = await prisma.account.findUnique({ where: { address } });
    if (existing) {
      throw new ApiError('ALREADY_EXISTS', 'address is already registered');
    }

    const account = await prisma.account.create({
      data: { address, memo: memo || null },
    });

    res.status(201).json({ address: account.address, memo: account.memo });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
