'use strict';

const { encryptSecret, decryptSecret } = require('../utils/webhookSecretCrypto');

module.exports = (sequelize, DataTypes) => {
  const Webhook = sequelize.define(
    'Webhook',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      merchantId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      url: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      secret: {
        type: DataTypes.STRING,
        allowNull: false,
        set(value) {
          this.setDataValue('secret', encryptSecret(value));
        },
        get() {
          return decryptSecret(this.getDataValue('secret'));
        },
      },
      events: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'Webhooks',
      timestamps: true,
    }
  );

  return Webhook;
};
