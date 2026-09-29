'use strict';

const express = require('express');
const router = express.Router();

const ownershipService = require('../../services/ownershipService');
const activityLogService = require('../../services/activityLogService');
const webhookService = require('../../services/webhookService');
const { requireSignature } = require('../../middleware/requireSignature');

/**
 * DELETE /webhooks/:id
 *
 * Deregisters (soft-deletes) an individual webhook owned by the
 * authenticated merchant. Requires a valid request signature.
 */
router.delete('/:id', requireSignature, async (req, res, next) => {
  try {
    const { id } = req.params;
    const merchantId = req.merchant && req.merchant.id;

    const webhook = await webhookService.findById(id);
    if (!webhook) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const isOwner = await ownershipService.verifyWebhookOwnership({
      webhookId: id,
      merchantId,
    });

    if (!isOwner) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    await webhookService.softDelete(id);

    await activityLogService.record({
      type: 'webhook.deleted',
      merchantId,
      resourceType: 'webhook',
      resourceId: id,
      metadata: {
        url: webhook.url,
        deletedAt: new Date().toISOString(),
      },
    });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
