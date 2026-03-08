const mongoose = require("mongoose");

const unitSchema = new mongoose.Schema({
  name: { type: String, required: true },

  subscriptionPlan: {
    type: String,
    enum: ["free", "pro", "enterprise"],
    default: "pro", // ⭐ 註冊預設給 Pro（Trial）
  },

  maxUsers: {
    type: Number,
    default: 50, // ⭐ Trial 期間 = Pro 等級
  },

  trialExpiresAt: {
    type: Date,
    default: function () {
      // ⭐ 註冊後 30 天
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    },
  },
});

module.exports = mongoose.model("Unit", unitSchema);
