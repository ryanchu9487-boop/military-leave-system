const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
      unique: true, // 한 부대는 하나의 구독 정보만 가짐
      index: true,
    },

    // 1. 플랜 정보
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "pro", // 회원가입 시 Pro 체험판 제공용
    },

    // 2. 상태 관리
    status: {
      type: String,
      enum: ["trialing", "active", "past_due", "canceled", "incomplete"],
      default: "trialing",
    },

    // 3. 사용량 제한 (현업 필수)
    maxUsers: {
      type: Number,
      default: 50,
    },

    // 4. 기간 설정
    currentPeriodStart: { type: Date, default: Date.now },
    currentPeriodEnd: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 기본 30일
    },

    // 5. 결제 연동 (예: Stripe, Portone 등)
    customerId: { type: String }, // 결제 대행사 고객 ID
    subscriptionId: { type: String }, // 결제 대행사 구독 고유 ID
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
