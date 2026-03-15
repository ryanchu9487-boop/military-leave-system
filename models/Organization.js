const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "조직 이름은 필수입니다."], trim: true, index: true },
    orgCode: { type: String, unique: true, uppercase: true, trim: true, required: [true, "조직 고유 코드는 필수입니다."] },
    license: {
      maxUsers: { type: Number, default: 500 },
      expiresAt: { type: Date },
      plan: { type: String, enum: ["basic", "pro", "enterprise"], default: "basic" },
      isPaid: { type: Boolean, default: false },
    },
    settings: {
      allowAutoApproval: { type: Boolean, default: false },
      allowReviewerRegistration: { type: Boolean, default: false },
      allowApproverRegistration: { type: Boolean, default: false },

      // ==========================================
      // 🔥 出島率 (출타율) 計算基準
      // ==========================================
      totalSoldiers: { type: Number, default: 100 }, // 總人數
      leaveRateShort: { type: Number, default: 15 }, // 預設 短假出島率 (%)
      leaveRateLong: { type: Number, default: 20 },  // 預設 長假出島率 (%)
      
      // 🔥 [新增] 特殊期間出島率 (區間限定)
      specialRates: [{
        startDate: String, // "YYYY-MM-DD"
        endDate: String,   // "YYYY-MM-DD"
        rateLong: Number,
        rateShort: Number,
        reason: String
      }],
      // ==========================================

      timezone: { type: String, default: "Asia/Seoul" },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    },
    adminContact: { name: String, phone: String },
    deploymentType: { type: String, enum: ["cloud", "on-premise"], default: "cloud" },
    status: { type: String, enum: ["active", "suspended", "pending", "expired"], default: "active", index: true },
  },
  { timestamps: true }
);

organizationSchema.index({ name: "text" });
module.exports = mongoose.model("Organization", organizationSchema);