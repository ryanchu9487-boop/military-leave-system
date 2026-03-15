const mongoose = require("mongoose");

const organizationSchema = new mongoose.Schema(
  {
    // 1️⃣ 조직 기본 정보
    name: {
      type: String,
      required: [true, "조직 이름은 필수입니다."],
      trim: true,
      index: true,
    },

    orgCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
      required: [true, "조직 고유 코드는 필수입니다."],
    },

    // 2️⃣ 라이선스 / 계약 정보 (商業核心)
    license: {
      maxUsers: { type: Number, default: 500 }, // 최대 인원
      expiresAt: { type: Date }, // 사용 만료일
      plan: {
        type: String,
        enum: ["basic", "pro", "enterprise"],
        default: "basic",
      },
      isPaid: { type: Boolean, default: false },
    },

    // 3️⃣ 부대 운영 설정
    settings: {
      allowAutoApproval: { type: Boolean, default: false },
      allowReviewerRegistration: { type: Boolean, default: false },
      allowApproverRegistration: { type: Boolean, default: false },

      // ==========================================
      // 🔥 [本次升級新增] 出島率 (출타율) 計算基準
      // ==========================================
      totalSoldiers: { type: Number, default: 100 }, // 該部隊的勇士總人數 (分母)
      leaveRateShort: { type: Number, default: 15 }, // 외출/외박 출타율 (%) - 預設 15%
      leaveRateLong: { type: Number, default: 20 },  // 휴가 출타율 (%) - 預設 20%
      // ==========================================

      timezone: { type: String, default: "Asia/Seoul" },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    },

    // 4️⃣ 관리자 연락처 (군 내부 연락)
    adminContact: {
      name: String,
      phone: String,
    },

    // 5️⃣ 서버 타입 (군 내부 설치용 대비)
    deploymentType: {
      type: String,
      enum: ["cloud", "on-premise"],
      default: "cloud",
    },

    // 6️⃣ 상태
    status: {
      type: String,
      enum: ["active", "suspended", "pending", "expired"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

organizationSchema.index({ name: "text" });

module.exports = mongoose.model("Organization", organizationSchema);